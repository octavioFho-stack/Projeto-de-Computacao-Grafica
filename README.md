# Implementação e Análise de Desempenho da Renderização de Sombras Dinâmicas via Algoritmo Z-Fail em Tempo Real

Projeto da disciplina de Computação Gráfica (Engenharia de Computação, FHO, Fundação Hermínio Ometto, Araras/SP), Prof. Renato Cagnin.

Alunos: Guilherme de Oliveira Rodrigues (RA 105926) e Octávio Gomes Chinalle (RA 109524)
Eixo de pesquisa: Eixo 7, Arquitetura de Consoles Antigos
Artigo base: C. Everitt e M. J. Kilgard, *Practical and Robust Stenciled Shadow Volumes for Hardware-Accelerated Rendering*, NVIDIA, 2002 (arXiv:cs/0301002)

Este projeto implementa a técnica de volumes de sombra com stencil buffer, na variante Z-Fail (*Carmack's Reverse*), aplicada a um cenário diferente do artigo base, uma cidade à noite. Nela, carros autônomos andam por uma grade de quarteirões, e os faróis de cada carro projetam sombras dinâmicas dos prédios e dos outros veículos.

O projeto foi feito em JavaScript puro + WebGL2 (GLSL ES 3.00), sem bibliotecas externas, e roda direto no navegador.

---

## Como rodar

Não precisa de instalação, build nem servidor. Basta abrir o arquivo `index.html` no Google Chrome.

Recomendamos o Chrome no desktop porque o tempo de GPU é medido pela extensão `EXT_disjoint_timer_query_webgl2` e o heap JS por `performance.memory`, e os dois só existem no Chrome. Em outros navegadores a aplicação funciona, mas essas métricas aparecem vazias.

No Windows, dê dois cliques no `index.html` ou use *Abrir com → Google Chrome*.

No WSL, a partir da pasta do projeto:
```bash
explorer.exe index.html
# ou, para forçar o Chrome:
cmd.exe /c start chrome "$(wslpath -w index.html)"
```

No VS Code, com a extensão *Live Server*, clique com o botão direito no `index.html` e escolha *Open with Live Server*.

> Para medir o desempenho, deixe a aba em primeiro plano. O FPS fica preso em 60 pelo V-Sync do navegador, por isso os tempos de CPU e de GPU são as métricas que realmente importam.

---

## Controles

| Ação | Comando |
|---|---|
| Alternar Z-Fail / Z-Pass | M |
| Mostrar os volumes extrudados (w = 0) | V |
| Pausar a simulação | P |
| Trocar a câmera (órbita → livre → seguir carro) | C |
| Câmera órbita | arrastar gira · botão direito desloca · roda dá zoom |
| Câmera livre | arrastar olha · WASD anda · Q/E desce/sobe · Shift acelera |

O painel lateral tem:
- instrumentação ao vivo (FPS, CPU, GPU, triângulos de sombra, testes OBB, memória);
- método Z-Fail ou Z-Pass, culling por cone ligado ou desligado e visualização dos volumes;
- farol desligado, baixo ou alto, número de carros, tamanho da cidade (3×3, 5×5, 7×7), velocidade da simulação e resolução interna (0,5× a 2,0×);
- Demonstração: câmera dentro da sombra: coloca a câmera dentro do volume de sombra de um carro, já em Z-Pass, para mostrar a falha. Aperte M para trocar para Z-Fail e ver a correção;
- Executar benchmark: veja a seção [Benchmark](#benchmark).

---

## Estrutura do código

```
index.html            interface: canvas, painel lateral e tabela de resultados
style.css
js/matematica.js      Vetor3, Matriz4, projeção perspectiva infinita, gerador aleatório com semente
js/obbtree.js         OBB, teste SAT (15 eixos), ajuste por covariância (Jacobi), OBBTree
js/geometria.js       malha do cubo com adjacência, construtor de volumes (silhueta + tampas), culling por cone
js/cena.js            cidade (prédios + OBBTree), carros com 2 faróis, simulação com steering behaviors
js/camera.js          câmeras órbita, livre e seguir carro
js/renderizador.js    pipeline WebGL2 multipasse com stencil e medição de GPU por timer query
js/benchmark.js       estatística (média, desvio padrão, p95), benchmark automático e exportação CSV
js/main.js            estado, interface, laço principal e demonstração Z-Pass × Z-Fail
```

São cerca de 2.225 linhas de JavaScript.

---

## Como funciona

### Pipeline de renderização (por quadro)

1. Passe ambiente: desenha a cena só com luz ambiente e grava a profundidade.
2. Para cada farol:
   - Stencil: desenha os volumes de sombra apenas no stencil, sem escrever cor nem profundidade, usando stencil de dois lados (`stencilOpSeparate`) com `INCR_WRAP` / `DECR_WRAP`:
     - Z-Fail: atualiza o contador quando o teste de profundidade falha. Costas incrementam e frente decrementa. Exige volume fechado, com tampas.
     - Z-Pass: atualiza o contador quando o teste passa. Só desenha as paredes laterais.
   - Luz: soma aditiva (`ONE, ONE`) com `depthFunc(EQUAL)`, aplicada só onde `stencil == 0`.

A projeção perspectiva infinita (P∞) coloca o plano distante no infinito. Assim, os vértices extrudados com w = 0 são rasterizados sem serem cortados.

### Construção dos volumes (CPU)

- Os oclusores são caixas fechadas: 8 vértices, 12 triângulos e 18 arestas com adjacência.
- Cada triângulo é classificado pelo sinal de n · (L − p), ou seja, se está voltado para a luz ou de costas.
- Arestas de silhueta são extrudadas até o infinito: (A,1), (B,1), (B−L,0), (A−L,0).
- Tampas: a próxima é formada pelos triângulos de costas para a luz, com a ordem invertida. A distante é a projeção desses mesmos triângulos no infinito.
- Culling conservador por cone: um oclusor é descartado quando a esfera que o envolve fica fora do alcance ou do ângulo do farol.

### Simulação

- Steering behaviors (Reynolds): seek/arrive, sensor frontal para desviar de obstáculos e reserva de cruzamento. Passo fixo de 1/60 s.
- OBBTree (Gottschalk, Lin e Manocha): acelera o sensor e a colisão com os prédios. O teste de interseção usa o Teorema do Eixo Separador.
- A cena é reproduzível: semente fixa `2024`.

---

## Benchmark

O botão Executar benchmark roda 36 configurações. Cada uma usa a mesma semente, 40 quadros de aquecimento e 150 quadros medidos.

| Experimento | O que varia | O que fica fixo |
|---|---|---|
| A: complexidade | cidade 3×3 / 5×5 / 7×7 × 1 / 4 / 8 / 12 carros × culling sim/não | Z-Fail, 1,0× |
| B: método | Z-Fail × Z-Pass × 1 / 4 / 8 / 12 carros | 5×5, culling ligado, 1,0× |
| C: resolução | escala 0,5× / 1,0× / 1,5× / 2,0× | 5×5, 8 carros, Z-Fail, culling |

Ao terminar, a página mostra a tabela de resultados e libera dois arquivos (`;` como separador e vírgula decimal, para abrir direto no Excel em português):
- `benchmark_resumo.csv`: uma linha por configuração, com média, desvio padrão e p95 de quadro, CPU e GPU, além de triângulos, testes OBB, VRAM estimada e heap;
- `benchmark_quadros.csv`: os dados brutos de cada quadro.

> A VRAM é estimada a partir dos buffers e framebuffers, porque o WebGL não informa a memória real da GPU.

### Principais resultados

- O Z-Fail corrige a falha de recorte com a câmera dentro da sombra, com custo de apenas +1,5% a +2,3% no tempo de GPU em relação ao Z-Pass.
- O culling por cone reduz em média 88,7% os triângulos de sombra.
- A OBBTree reduz em média 62,2% os testes de colisão em relação à força bruta.

---
