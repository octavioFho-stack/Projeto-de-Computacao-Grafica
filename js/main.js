/*
  main.js
  Liga tudo: estado da aplicacao, interface (botoes), laco principal,
  instrumentacao do painel, demonstracao Z-Pass x Z-Fail e o benchmark.
*/
'use strict';

const SEMENTE = 2024;

const estado = {
    modoFarol: 1,            // 0 desligado, 1 baixo, 2 alto
    metodo: 'zfail',         // 'zfail' ou 'zpass'
    culling: true,           // culling de oclusores pelo cone/alcance do farol
    mostrarVolumes: false,
    pausado: false,
    multiplicadorVelocidade: 1.0,
    escalaResolucao: 1.0,
    tamanhoCidade: 3,
    quantidadeCarros: 3
};

const el = id => document.getElementById(id);

let renderizador = null;
let cidade = null;
let simulacao = null;
let camera = null;
let objetosCidade = [];
let benchmark = null;
const janela = new JanelaMetricas(1000);
const COR_ZERO = [0, 0, 0];

// ---------------------------------------------------------------------------
// Cena
// ---------------------------------------------------------------------------
function reconstroiCena(manterCamera) {
    cidade = new Cidade(estado.tamanhoCidade, SEMENTE);
    estado.quantidadeCarros = Math.min(estado.quantidadeCarros, cidade.maxCarros());
    simulacao = new Simulacao(cidade, estado.quantidadeCarros, SEMENTE);
    objetosCidade = [{ matriz: cidade.chao.matriz, cor: cidade.chao.cor, ambiente: 0.35, emissivo: COR_ZERO }];
    for (const p of cidade.predios) {
        objetosCidade.push({ matriz: p.matriz, cor: p.cor, ambiente: 0.35, emissivo: COR_ZERO });
    }
    if (!manterCamera) camera.padraoParaCidade(cidade);
}

function montaObjetos() {
    const lista = objetosCidade.slice();
    const lenteAcesa = estado.modoFarol > 0 ? [1.0, 0.95, 0.75] : [0.12, 0.12, 0.1];
    for (const c of simulacao.carros) {
        lista.push({ matriz: c.matrizChassi, cor: c.cor, ambiente: 0.55, emissivo: COR_ZERO });
        lista.push({ matriz: c.matrizCabine, cor: [0.12, 0.15, 0.2], ambiente: 0.5, emissivo: COR_ZERO });
        for (const m of c.matrizesLentes) {
            lista.push({ matriz: m, cor: [0.9, 0.9, 0.8], ambiente: 0.3, emissivo: lenteAcesa });
        }
    }
    return lista;
}

function montaLuzes() {
    if (estado.modoFarol === 0) return [];
    const luzes = [];
    for (const c of simulacao.carros) luzes.push(...c.farois(estado.modoFarol));
    return luzes;
}

function montaOclusores() {
    const lista = cidade.predios.map(p => p.oclusor);
    for (const c of simulacao.carros) lista.push(c.oclusorChassi, c.oclusorCabine);
    return lista;
}

// Em quantos volumes de sombra a camera esta? (segmento luz -> camera atravessa o oclusor)
// E justamente o caso em que o Z-Pass falha e o Z-Fail continua correto.
function contaVolumesComCamera(luzes, oclusores, posCamera) {
    let n = 0;
    for (const luz of luzes) {
        for (const ocl of oclusores) {
            if (ocl.dono === luz.dono) continue;
            if (estado.culling && !oclusorAfetaLuz(ocl, luz)) continue;
            if (segmentoIntersectaOBB(luz.pos, posCamera, ocl.obb)) n++;
        }
    }
    return n;
}

// ---------------------------------------------------------------------------
// Demonstracao: coloca a camera dentro do volume de sombra de um carro
// O carro 1 ilumina o carro 2 por tras; a camera fica logo a frente do carro 2,
// dentro da sombra dele, olhando para a rua iluminada. Com Z-Pass a contagem do
// stencil fica deslocada (o que esta iluminado aparece escuro e vice-versa).
// ---------------------------------------------------------------------------
function demonstracaoCameraNaSombra() {
    estado.quantidadeCarros = 2;
    estado.modoFarol = 2;
    estado.metodo = 'zpass';
    estado.mostrarVolumes = false;
    reconstroiCena(true);
    const iz = Math.min(1, cidade.n);
    const carroLuz = simulacao.carros[0];
    const carroSombra = simulacao.carros[1];
    carroLuz.posiciona(cidade, simulacao.rng, 0, iz, [1, 0], 0.12);
    carroSombra.posiciona(cidade, simulacao.rng, 0, iz, [1, 0], 0.62);
    estado.pausado = true;

    // farol esquerdo do carro 1 -> centro da cabine do carro 2
    const luz = carroLuz.farois(estado.modoFarol)[0];
    const obb = carroSombra.oclusorCabine.obb;
    const raio = Vetor3.normaliza(Vetor3.subtrai(obb.c, luz.pos));
    const intervalo = intervaloRetaOBB(luz.pos, raio, obb);
    const pos = Vetor3.soma(luz.pos, Vetor3.escala(raio, intervalo[1] + 2.6));
    camera.modo = 'livre';
    camera.posLivre = pos;
    // olha para a rua ao lado do carro 2, que o farol do carro 1 ilumina
    const e = carroSombra.eixos();
    camera.olharPara([
        carroSombra.pos[0] - e.frente[0] * 2.2 + e.direita[0] * 1.2, 0.0,
        carroSombra.pos[1] - e.frente[2] * 2.2 + e.direita[2] * 1.2
    ]);
    atualizaInterface();
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------
function marcaAtivo(seletor, valor) {
    document.querySelectorAll(seletor).forEach(b => b.classList.toggle('active', b.dataset.valor === String(valor)));
}

function atualizaInterface() {
    marcaAtivo('[data-grupo="farol"]', estado.modoFarol);
    marcaAtivo('[data-grupo="metodo"]', estado.metodo);
    marcaAtivo('[data-grupo="camera"]', camera.modo);
    marcaAtivo('[data-grupo="cidade"]', estado.tamanhoCidade);
    marcaAtivo('[data-grupo="escala"]', estado.escalaResolucao);
    const n = simulacao.carros.length;
    el('btn-car-count').innerText = n === 1 ? '1 Carro' : n + ' Carros';
    el('btn-speed').innerText = estado.multiplicadorVelocidade.toFixed(estado.multiplicadorVelocidade < 1 ? 2 : 1) + 'x';
    el('btn-pausa').innerText = estado.pausado ? 'Continuar' : 'Pausar';
    el('btn-pausa').classList.toggle('active', estado.pausado);
    const bc = el('btn-culling');
    bc.classList.toggle('active', estado.culling);
    bc.innerText = estado.culling ? 'Culling por cone: Ligado' : 'Culling por cone: Desligado';
    const bv = el('btn-toggle-volumes');
    bv.classList.toggle('active', estado.mostrarVolumes);
    bv.innerText = estado.mostrarVolumes ? 'Ocultar Volumes Extrudados' : 'Mostrar Volumes Extrudados (W=0)';
}

function ligaInterface() {
    document.querySelectorAll('[data-grupo]').forEach(b => {
        b.addEventListener('click', () => {
            const g = b.dataset.grupo, v = b.dataset.valor;
            if (g === 'farol') estado.modoFarol = Number(v);
            if (g === 'metodo') estado.metodo = v;
            if (g === 'camera') camera.modo = v;
            if (g === 'escala') estado.escalaResolucao = Number(v);
            if (g === 'cidade') {
                estado.tamanhoCidade = Number(v);
                reconstroiCena(false);
            }
            atualizaInterface();
        });
    });
    el('btn-car-menos').addEventListener('click', () => { simulacao.removeCarro(); estado.quantidadeCarros = simulacao.carros.length; atualizaInterface(); });
    el('btn-car-mais').addEventListener('click', () => { simulacao.adicionaCarro(); estado.quantidadeCarros = simulacao.carros.length; atualizaInterface(); });
    el('btn-vel-menos').addEventListener('click', () => { estado.multiplicadorVelocidade = Math.max(0.125, estado.multiplicadorVelocidade / 2); atualizaInterface(); });
    el('btn-vel-mais').addEventListener('click', () => { estado.multiplicadorVelocidade = Math.min(4, estado.multiplicadorVelocidade * 2); atualizaInterface(); });
    el('btn-pausa').addEventListener('click', () => { estado.pausado = !estado.pausado; atualizaInterface(); });
    el('btn-culling').addEventListener('click', () => { estado.culling = !estado.culling; atualizaInterface(); });
    el('btn-toggle-volumes').addEventListener('click', () => { estado.mostrarVolumes = !estado.mostrarVolumes; atualizaInterface(); });
    el('btn-demo').addEventListener('click', demonstracaoCameraNaSombra);
    el('btn-bench').addEventListener('click', () => {
        if (benchmark.ativo) { benchmark.cancela(); restauraEstado(); document.body.classList.remove('benchmark-rodando'); atualizaBenchmarkUI(); return; }
        estadoAntesDoBenchmark = { estado: Object.assign({}, estado), modoCamera: camera.modo };
        el('resultados').hidden = true;
        benchmark.inicia();
        document.body.classList.add('benchmark-rodando');
        atualizaBenchmarkUI();
    });
    el('btn-csv-resumo').addEventListener('click', () => baixaArquivo('benchmark_resumo.csv', benchmark.csvResumo()));
    el('btn-csv-bruto').addEventListener('click', () => baixaArquivo('benchmark_quadros.csv', benchmark.csvBruto()));

    // Atalhos de teclado
    window.addEventListener('keydown', ev => {
        if (benchmark.ativo) return;
        const k = ev.key.toLowerCase();
        if (k === 'p') estado.pausado = !estado.pausado;
        else if (k === 'v') estado.mostrarVolumes = !estado.mostrarVolumes;
        else if (k === 'm') estado.metodo = estado.metodo === 'zfail' ? 'zpass' : 'zfail';
        else if (k === 'c') camera.modo = { orbita: 'livre', livre: 'seguir', seguir: 'orbita' }[camera.modo];
        else return;
        atualizaInterface();
    });
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------
function aplicaConfiguracaoBenchmark(cfg) {
    estado.tamanhoCidade = cfg.cidade;
    estado.quantidadeCarros = cfg.carros;
    estado.metodo = cfg.metodo;
    estado.culling = cfg.culling;
    estado.escalaResolucao = cfg.escala;
    estado.modoFarol = 2;
    estado.pausado = false;
    estado.multiplicadorVelocidade = 1;
    estado.mostrarVolumes = false;
    camera.modo = 'orbita';
    reconstroiCena(false); // mesma semente: mesma cidade e mesmos movimentos
    atualizaInterface();
}

let estadoAntesDoBenchmark = null;

function restauraEstado() {
    if (!estadoAntesDoBenchmark) return;
    Object.assign(estado, estadoAntesDoBenchmark.estado);
    reconstroiCena(false);
    camera.modo = estadoAntesDoBenchmark.modoCamera;
    estadoAntesDoBenchmark = null;
    atualizaInterface();
}

function aoTerminarBenchmark(resumo) {
    restauraEstado();
    document.body.classList.remove('benchmark-rodando');
    atualizaBenchmarkUI();
    const f = (v, d) => (typeof v === 'number' && !isNaN(v)) ? v.toFixed(d === undefined ? 2 : d) : 'n/d';
    const corpo = el('tabela-resultados').querySelector('tbody');
    corpo.innerHTML = '';
    for (const r of resumo) {
        const tr = document.createElement('tr');
        const celulas = [r.experimento, r.cidade, r.carros, r.luzes, r.metodo, r.culling, r.resolucao,
            f(r.fps_medio, 1), f(r.quadro_ms_medio) + ' ± ' + f(r.quadro_ms_dp), f(r.cpu_ms_medio) + ' ± ' + f(r.cpu_ms_dp),
            f(r.volumes_ms_medio), f(r.gpu_ms_medio), f(r.triangulos_sombra_medio, 0),
            f(r.oclusores_processados_medio, 0) + ' / ' + f(r.oclusores_possiveis_medio, 0)];
        for (const c of celulas) {
            const td = document.createElement('td');
            td.textContent = c;
            tr.appendChild(td);
        }
        corpo.appendChild(tr);
    }
    el('resultados-info').textContent = resumo.length + ' configuracoes em ' + benchmark.duracaoS.toFixed(0) + ' s | ' +
        benchmark.quadrosMedicao + ' quadros medidos por configuracao (apos ' + benchmark.quadrosAquecimento + ' de aquecimento)' +
        (renderizador.extTimer ? '' : ' | tempo de GPU indisponivel neste navegador');
    el('resultados').hidden = false;
    el('resultados').scrollIntoView({ behavior: 'smooth' });
}

function atualizaBenchmarkUI() {
    const ativo = benchmark.ativo;
    el('btn-bench').innerText = ativo ? 'Cancelar benchmark' : 'Executar benchmark (~2 min)';
    el('btn-bench').classList.toggle('warning', ativo);
    el('btn-bench').classList.toggle('active', ativo);
    const temDados = !ativo && benchmark.resumo.length > 0;
    el('btn-csv-resumo').disabled = !temDados;
    el('btn-csv-bruto').disabled = !temDados;
    el('bench-barra').style.width = (ativo ? benchmark.progresso * 100 : (temDados ? 100 : 0)) + '%';
    if (ativo) {
        const c = benchmark.configAtual;
        el('bench-status').textContent = 'Config. ' + (benchmark.indice + 1) + '/' + benchmark.configs.length + ': ' +
            c.cidade + 'x' + c.cidade + ', ' + c.carros + ' carro(s), ' + (c.metodo === 'zfail' ? 'Z-Fail' : 'Z-Pass') +
            ', culling ' + (c.culling ? 'on' : 'off') + ', ' + c.escala + 'x';
    } else {
        el('bench-status').textContent = temDados ? 'Concluido. Baixe os CSVs para o artigo.' : 'Mede 36 configuracoes automaticamente.';
    }
}

// ---------------------------------------------------------------------------
// Painel de instrumentacao
// ---------------------------------------------------------------------------
let ultimaAtualizacaoPainel = 0;

function atualizaPainel(agora, camDentro) {
    if (agora - ultimaAtualizacaoPainel < 250) return;
    ultimaAtualizacaoPainel = agora;
    const f = (v, d) => (typeof v === 'number' && !isNaN(v)) ? v.toFixed(d) : 'n/d';
    const msQuadro = janela.media('msQuadro');
    el('fps').innerText = f(1000 / msQuadro, 0);
    el('ms').innerText = f(msQuadro, 2);
    el('cpu').innerText = f(janela.media('msCPU'), 2);
    el('gpu').innerText = renderizador.extTimer ? f(janela.media('msGPU'), 2) : 'indisponivel';
    el('cpu-partes').innerText = f(janela.media('msSimulacao'), 2) + ' / ' + f(janela.media('msVolumes'), 2) + ' / ' + f(janela.media('msDesenho'), 2);
    el('luzes').innerText = f(janela.media('luzes'), 0);
    el('tris').innerText = f(janela.media('triangulosSombra'), 0);
    el('oclusores').innerText = f(janela.media('oclusoresProcessados'), 0) + ' / ' + f(janela.media('oclusoresPossiveis'), 0);
    el('draws').innerText = f(janela.media('drawCalls'), 0);
    el('obb').innerText = f(janela.media('testesArvore'), 0) + ' / ' + f(janela.media('testesForcaBruta'), 0);
    el('colisoes').innerText = simulacao.colisoes;
    el('resolucao').innerText = renderizador.largura + 'x' + renderizador.altura + ' (' + estado.escalaResolucao + 'x)';
    const heap = janela.media('heapMB');
    el('memoria').innerText = f(janela.media('vramMB'), 1) + ' MB / ' + (isNaN(heap) ? 'n/d' : f(heap, 1) + ' MB');

    const aviso = el('aviso-camera');
    if (camDentro > 0 && estado.modoFarol > 0) {
        aviso.hidden = false;
        aviso.className = estado.metodo === 'zpass' ? 'aviso erro' : 'aviso ok';
        aviso.innerHTML = 'Câmera dentro de <b>' + camDentro + '</b> volume(s) de sombra<br>' +
            (estado.metodo === 'zpass'
                ? 'Z-Pass: contagem do stencil incorreta (sombras invertidas). Tecle M ou escolha Z-Fail.'
                : 'Z-Fail: contagem a partir do infinito, sombras corretas.');
    } else {
        aviso.hidden = true;
    }
    if (benchmark.ativo) atualizaBenchmarkUI();
}

// ---------------------------------------------------------------------------
// Laco principal
// ---------------------------------------------------------------------------
let ultimoTempo = null;

function quadro(tempoAtual) {
    const inicioCPU = performance.now();
    const dtMs = ultimoTempo === null ? 16.7 : tempoAtual - ultimoTempo;
    ultimoTempo = tempoAtual;

    // tempos de GPU de quadros anteriores
    for (const r of renderizador.coletaMedicoesGPU()) r.etiqueta.msGPU = r.ms;

    benchmark.antesDoQuadro();

    // Simulacao (steering + OBBTree)
    const t0 = performance.now();
    const testesArvoreAntes = simulacao.testesArvore, forcaBrutaAntes = simulacao.testesForcaBruta;
    if (!estado.pausado) simulacao.avanca(dtMs / 1000 * estado.multiplicadorVelocidade);
    camera.atualiza(Math.min(dtMs, 100) / 1000);
    const msSimulacao = performance.now() - t0;

    // Renderizacao
    renderizador.ajustaResolucao(estado.escalaResolucao);
    const visao = camera.visao(simulacao.carros[0]);
    const luzes = montaLuzes();
    const oclusores = montaOclusores();
    const amostra = { instante: tempoAtual };
    renderizador.iniciaMedicaoGPU(amostra);
    const est = renderizador.renderiza({
        objetos: montaObjetos(),
        luzes: luzes,
        oclusores: oclusores,
        matrizVisao: visao.matrizVisao,
        metodo: estado.metodo,
        culling: estado.culling,
        mostrarVolumes: estado.mostrarVolumes
    });
    renderizador.finalizaMedicaoGPU();
    const camDentro = contaVolumesComCamera(luzes, oclusores, visao.pos);

    Object.assign(amostra, {
        msQuadro: dtMs,
        msCPU: performance.now() - inicioCPU,
        msSimulacao: msSimulacao,
        msVolumes: est.msVolumes,
        msDesenho: est.msDesenho,
        triangulosSombra: est.triangulosSombra,
        oclusoresProcessados: est.oclusoresProcessados,
        oclusoresPossiveis: est.oclusoresPossiveis,
        drawCalls: est.drawCalls,
        bytesVolumes: est.bytesVolumes,
        testesArvore: simulacao.testesArvore - testesArvoreAntes,
        testesForcaBruta: simulacao.testesForcaBruta - forcaBrutaAntes,
        luzes: est.luzes,
        carros: simulacao.carros.length,
        predios: cidade.predios.length,
        resolucao: renderizador.largura + 'x' + renderizador.altura,
        vramMB: renderizador.memoriaEstimadaBytes() / (1024 * 1024),
        heapMB: performance.memory ? performance.memory.usedJSHeapSize / (1024 * 1024) : NaN,
        cameraDentroDeVolumes: camDentro
    });
    if (ultimoTempo !== null) janela.adiciona(amostra);
    benchmark.depoisDoQuadro(amostra);
    atualizaPainel(tempoAtual, camDentro);

    requestAnimationFrame(quadro);
}

function inicia() {
    try {
        renderizador = new Renderizador(el('glCanvas'));
    } catch (e) {
        el('erro').hidden = false;
        el('erro').textContent = e.message;
        return;
    }
    camera = new Camera(el('glCanvas'));
    benchmark = new Benchmark(aplicaConfiguracaoBenchmark, aoTerminarBenchmark);
    reconstroiCena(false);
    ligaInterface();
    atualizaInterface();
    atualizaBenchmarkUI();
    el('stencil-bits').innerText = renderizador.bitsStencil;
    requestAnimationFrame(quadro);
}

inicia();
