# WebXR Pinch Interaction Engine

Este projeto consiste em um motor de computação espacial e realidade aumentada baseado em navegador (Web AR). O sistema integra visão computacional em tempo real para rastreamento de mãos, modelos preditivos customizados de Machine Learning para classificação de gestos e renderização 3D avançada, permitindo interações físicas bidestras (bimanual interaction) com objetos virtuais projetados sobre o ambiente real.

<img src="https://github.com/user-attachments/assets/be1a1cbe-a416-4a51-9a62-cd9fb0aadef6" alt="Demonstração do Projeto" width="75%">

## 1. Arquitetura do Sistema

A aplicação foi desenvolvida sob o paradigma de *Screen-Space AR* (Magic Window), contornando as limitações de bloqueio de hardware da API WebXR nativa. A arquitetura é dividida em três camadas principais:

* **Camada de Captura (HTML5 Video & getUserMedia):** Gerencia o fluxo da câmera do dispositivo (frontal ou traseira), aplicando o espelhamento via transformações CSS para garantir alinhamento cognitivo sem interferir nas coordenadas matemáticas.
* **Camada de Visão Computacional (MediaPipe Hands):** Rastreia até duas mãos simultaneamente, extraindo 21 *landmarks* tridimensionais (x, y, z) para cada mão por frame.
* **Camada de Renderização 3D (Three.js):** Projeta as malhas interativas sobre o vídeo usando materiais físicos (MeshStandardMaterial), luzes emissivas com Additive Blending (simulando Bloom) e mapeamento de sombras suaves (PCFSoftShadowMap) sobre um plano de recepção.

## 2. Projeção Espacial e Frustum

Para que as coordenadas normalizadas da rede neural (0.0 a 1.0) correspondam perfeitamente ao espaço tridimensional da câmera no Three.js, foi aplicada uma projeção matemática baseada no *Frustum* (pirâmide de visão). 

Definindo uma profundidade base ($z_{base} = 0.5$ metros), a altura e a largura da projeção são calculadas a partir do campo de visão vertical ($vFov$) da câmera:

$$H_{frustum} = 2 \cdot \tan\left(\frac{vFov}{2}\right) \cdot z_{base}$$
$$W_{frustum} = H_{frustum} \cdot aspect\_ratio$$

As coordenadas espaciais das juntas da mão ($P_{x}, P_{y}$) são então mapeadas para preencher exatamente este plano projetado.

## 3. Pipeline de Visão Computacional e Machine Learning

A classificação do gesto de "pinça" (Pinch) é orientada por um pipeline customizado de aprendizado de máquina, otimizado para execução local de baixa latência no navegador.

### 3.1. Base de Dados e Extração
O modelo foi treinado utilizando o dataset público `gti-upm/leapgestrecog` disponibilizado no Kaggle. O escopo foi modelado como um problema de classificação binária, mapeando as imagens pertencentes à classe `07_ok` como positivas (pinça) e as da classe `01_palm` como negativas (mão aberta). O processamento inicial e a extração das coordenadas tridimensionais das juntas da mão foram executados sobre as imagens do dataset utilizando o framework MediaPipe. 

<img width="1160" height="534" alt="Captura de tela 2026-03-08 144700" src="https://github.com/user-attachments/assets/059c3923-a812-41bc-8bcd-65a53227f13a" />

### 3.2. Engenharia de Features
Para garantir invariância de escala (independente da distância da mão em relação à lente da câmera), a *feature* extraída não corresponde à coordenada bruta, mas sim à distância euclidiana espacial normalizada.

A distância da pinça ($D_{pinch}$) é calculada entre a ponta do polegar ($P_4$) e a ponta do indicador ($P_8$):

$$D_{pinch} = \sqrt{(x_8 - x_4)^2 + (y_8 - y_4)^2 + (z_8 - z_4)^2}$$

Para a normalização, o tamanho base da palma da mão ($D_{palm}$) é mensurado do pulso ($P_0$) até a articulação base do dedo médio ($P_9$):

$$D_{palm} = \sqrt{(x_9 - x_0)^2 + (y_9 - y_0)^2 + (z_9 - z_0)^2}$$

A *feature* tabular final ($F$) alimentada à rede é a razão geométrica entre as distâncias:

$$F = \frac{D_{pinch}}{D_{palm}}$$

### 3.3. Treinamento e Otimização
O algoritmo selecionado para classificação foi o `DecisionTreeClassifier` (Árvore de Decisão), pertencente à biblioteca scikit-learn. O conjunto de dados tabulares gerado foi particionado, reservando 80% das amostras para a etapa de treinamento e 20% para a etapa de validação (teste).

Para maximizar a acurácia global do modelo preditivo, uma busca exaustiva por hiperparâmetros foi executada utilizando o método `GridSearchCV` com validação cruzada estruturada em 5 partições (*5-fold cross-validation*). O espaço de otimização testado incluiu variações restritas na profundidade máxima (`max_depth`), na quantidade mínima de amostras para ramificação (`min_samples_split`) e nos critérios de avaliação de qualidade ('gini' e 'entropy').

### 3.4. Transpilação para JavaScript
Visando eliminar a dependência de frameworks complexos de *Deep Learning* no lado do cliente, a árvore de decisão ótima foi transpilada nativamente para código JavaScript puro utilizando o módulo `m2cgen`. O código matemático resultante foi exportado diretamente para o arquivo cliente `pinch_model.js`, viabilizando inferências em tempo real com custo de processamento imperceptível. Caso o escore retornado pela classe de pinça exceda o limite empírico de $0.5$, o estado lógico de interação do motor é disparado.

## 4. Mecânica Bidestra (Bimanual Interaction)

Para maximizar a precisão da interface, o motor utiliza o conceito de responsabilidades isoladas para as mãos, identificadas dinamicamente.

### 4.1. Navegação e Colisão (Mão Esquerda)
A Mão Esquerda é responsável pela seleção e translação de objetos em tela. A detecção de colisão é calculada utilizando o centroide geométrico da pinça ativa ($C_{pinch}$):

$$C_{pinch} = \frac{\vec{P}_{index} + \vec{P}_{thumb}}{2}$$

Se a distância euclidiana entre o vetor $C_{pinch}$ e a origem do modelo do objeto for menor que o limiar estabelecido, a rotina de intersecção é satisfeita.

### 4.2. Escala Relativa Bimanual (Mão Direita)
A Mão Direita atua de forma secundária como ferramenta de manipulação de *zoom*. Enquanto o objeto encontra-se retido pela mão principal, o afastamento entre os dígitos da mão livre atua como entrada contínua para computação do multiplicador escalar relativo:

$$Scale_{new} = Scale_{initial} \cdot \left( \frac{D_{current\_pinch}}{D_{initial\_pinch}} \right)$$

Este design matricial garante variações topológicas contínuas de *scale* sem perda da proporção base entre interações subsequentes.

## 5. Inicialização do Ambiente

O projeto é empacotado e servido utilizando o *bundler* de alta performance Vite.

```bash
# as dependencias fundamentais sao construidas
pnpm install

# o servidor de desenvolvimento é instanciado na rede
pnpm dev --host
