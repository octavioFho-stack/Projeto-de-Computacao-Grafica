/*
  benchmark.js
  - Estatisticas (media, desvio padrao, percentil 95).
  - JanelaMetricas: medias do ultimo segundo para o painel.
  - Benchmark: percorre automaticamente uma lista de configuracoes, mede cada uma
    por um numero fixo de quadros (com aquecimento antes) e gera os CSVs.
*/
'use strict';

const Estatistica = {
    media(v) {
        if (!v.length) return NaN;
        let s = 0;
        for (const x of v) s += x;
        return s / v.length;
    },
    desvio(v) {
        if (v.length < 2) return 0;
        const m = Estatistica.media(v);
        let s = 0;
        for (const x of v) s += (x - m) * (x - m);
        return Math.sqrt(s / (v.length - 1));
    },
    percentil(v, p) {
        if (!v.length) return NaN;
        const o = v.slice().sort((a, b) => a - b);
        const i = Math.min(o.length - 1, Math.max(0, Math.ceil(p / 100 * o.length) - 1));
        return o[i];
    }
};

class JanelaMetricas {
    constructor(duracaoMs) {
        this.duracao = duracaoMs || 1000;
        this.amostras = [];
    }

    adiciona(a) {
        this.amostras.push(a);
        const limite = a.instante - this.duracao;
        while (this.amostras.length && this.amostras[0].instante < limite) this.amostras.shift();
    }

    media(campo) {
        const v = [];
        for (const a of this.amostras) {
            if (typeof a[campo] === 'number' && !isNaN(a[campo])) v.push(a[campo]);
        }
        return Estatistica.media(v);
    }

    get quantidade() {
        return this.amostras.length;
    }
}

// Configuracoes do benchmark: tres experimentos
function listaConfiguracoesBenchmark() {
    const lista = [];
    // A) Complexidade da cena: cidade x carros x culling (Z-Fail, escala 1x)
    for (const cidade of [3, 5, 7]) {
        for (const carros of [1, 4, 8, 12]) {
            for (const culling of [false, true]) {
                lista.push({ experimento: 'A_complexidade', cidade, carros, metodo: 'zfail', culling, escala: 1 });
            }
        }
    }
    // B) Custo do metodo: Z-Fail (com tampas) x Z-Pass (sem tampas)
    for (const carros of [1, 4, 8, 12]) {
        for (const metodo of ['zfail', 'zpass']) {
            lista.push({ experimento: 'B_metodo', cidade: 5, carros, metodo, culling: true, escala: 1 });
        }
    }
    // C) Resolucao (fill rate): escala da resolucao interna
    for (const escala of [0.5, 1, 1.5, 2]) {
        lista.push({ experimento: 'C_resolucao', cidade: 5, carros: 8, metodo: 'zfail', culling: true, escala });
    }
    return lista;
}

class Benchmark {
    // aplicaConfiguracao(cfg) prepara a cena; aoTerminar(resumo) recebe as linhas
    constructor(aplicaConfiguracao, aoTerminar) {
        this.aplica = aplicaConfiguracao;
        this.aoTerminar = aoTerminar;
        this.ativo = false;
        this.quadrosAquecimento = 40;
        this.quadrosMedicao = 150;
        this.resumo = [];
        this.amostras = [];
    }

    inicia() {
        this.configs = listaConfiguracoesBenchmark();
        this.indice = 0;
        this.fase = 'aplicar';
        this.contador = 0;
        this.amostras = [];
        this.resumo = [];
        this.ativo = true;
        this.inicioMs = performance.now();
    }

    cancela() {
        this.ativo = false;
    }

    get progresso() {
        if (!this.ativo) return 1;
        const total = this.configs.length * (this.quadrosAquecimento + this.quadrosMedicao);
        let feito = this.indice * (this.quadrosAquecimento + this.quadrosMedicao);
        if (this.fase === 'aquecer') feito += this.contador;
        if (this.fase === 'medir') feito += this.quadrosAquecimento + this.contador;
        return Math.min(1, feito / total);
    }

    get configAtual() {
        return this.ativo ? this.configs[Math.min(this.indice, this.configs.length - 1)] : null;
    }

    // Chamado no inicio de cada quadro
    antesDoQuadro() {
        if (!this.ativo) return;
        if (this.fase === 'aplicar') {
            this.aplica(this.configs[this.indice]);
            this.fase = 'aquecer';
            this.contador = 0;
        }
    }

    // Chamado no fim de cada quadro com a amostra medida
    depoisDoQuadro(amostra) {
        if (!this.ativo) return;
        if (this.fase === 'aquecer') {
            if (++this.contador >= this.quadrosAquecimento) { this.fase = 'medir'; this.contador = 0; }
        } else if (this.fase === 'medir') {
            amostra.cfgIndice = this.indice;
            amostra.quadro = this.contador;
            this.amostras.push(amostra);
            if (++this.contador >= this.quadrosMedicao) {
                this.indice++;
                this.contador = 0;
                this.fase = this.indice < this.configs.length ? 'aplicar' : 'drenar';
            }
        } else if (this.fase === 'drenar') {
            // espera os ultimos tempos de GPU chegarem
            if (++this.contador >= 15) this._finaliza();
        }
    }

    _finaliza() {
        this.ativo = false;
        this.resumo = this.configs.map((cfg, i) => {
            const am = this.amostras.filter(a => a.cfgIndice === i);
            const col = c => am.map(a => a[c]).filter(x => typeof x === 'number' && !isNaN(x));
            const quadro = col('msQuadro'), cpu = col('msCPU'), gpu = col('msGPU');
            const r = am[0] || {};
            return {
                experimento: cfg.experimento,
                cidade: cfg.cidade + 'x' + cfg.cidade,
                predios: r.predios,
                carros: r.carros,
                luzes: r.luzes,
                metodo: cfg.metodo === 'zfail' ? 'Z-Fail' : 'Z-Pass',
                culling: cfg.culling ? 'sim' : 'nao',
                escala: cfg.escala,
                resolucao: r.resolucao,
                quadros: am.length,
                fps_medio: 1000 / Estatistica.media(quadro),
                quadro_ms_medio: Estatistica.media(quadro),
                quadro_ms_dp: Estatistica.desvio(quadro),
                quadro_ms_p95: Estatistica.percentil(quadro, 95),
                cpu_ms_medio: Estatistica.media(cpu),
                cpu_ms_dp: Estatistica.desvio(cpu),
                cpu_ms_p95: Estatistica.percentil(cpu, 95),
                sim_ms_medio: Estatistica.media(col('msSimulacao')),
                volumes_ms_medio: Estatistica.media(col('msVolumes')),
                desenho_ms_medio: Estatistica.media(col('msDesenho')),
                gpu_ms_medio: gpu.length ? Estatistica.media(gpu) : NaN,
                gpu_ms_dp: gpu.length ? Estatistica.desvio(gpu) : NaN,
                gpu_ms_p95: gpu.length ? Estatistica.percentil(gpu, 95) : NaN,
                triangulos_sombra_medio: Estatistica.media(col('triangulosSombra')),
                oclusores_processados_medio: Estatistica.media(col('oclusoresProcessados')),
                oclusores_possiveis_medio: Estatistica.media(col('oclusoresPossiveis')),
                draw_calls_medio: Estatistica.media(col('drawCalls')),
                volumes_kb_medio: Estatistica.media(col('bytesVolumes')) / 1024,
                testes_obb_arvore_medio: Estatistica.media(col('testesArvore')),
                testes_obb_forca_bruta_medio: Estatistica.media(col('testesForcaBruta')),
                vram_estimada_mb: Estatistica.media(col('vramMB')),
                heap_js_mb: Estatistica.media(col('heapMB'))
            };
        });
        this.duracaoS = (performance.now() - this.inicioMs) / 1000;
        this.aoTerminar(this.resumo);
    }

    // CSV no padrao brasileiro (separador ';' e virgula decimal) para abrir no Excel/Sheets
    static paraCSV(linhas) {
        if (!linhas.length) return '';
        const cab = Object.keys(linhas[0]);
        const fmt = v => {
            if (typeof v === 'number') {
                if (isNaN(v)) return '';
                return (Number.isInteger(v) ? String(v) : v.toFixed(4)).replace('.', ',');
            }
            return v === undefined || v === null ? '' : String(v);
        };
        return [cab.join(';')].concat(linhas.map(l => cab.map(c => fmt(l[c])).join(';'))).join('\n');
    }

    csvResumo() {
        return Benchmark.paraCSV(this.resumo);
    }

    csvBruto() {
        const linhas = this.amostras.map(a => {
            const cfg = this.configs[a.cfgIndice];
            return {
                experimento: cfg.experimento, cidade: cfg.cidade + 'x' + cfg.cidade, carros: a.carros, luzes: a.luzes,
                metodo: cfg.metodo === 'zfail' ? 'Z-Fail' : 'Z-Pass', culling: cfg.culling ? 'sim' : 'nao',
                escala: cfg.escala, resolucao: a.resolucao, quadro: a.quadro,
                quadro_ms: a.msQuadro, cpu_ms: a.msCPU, sim_ms: a.msSimulacao, volumes_ms: a.msVolumes,
                desenho_ms: a.msDesenho, gpu_ms: a.msGPU, triangulos_sombra: a.triangulosSombra,
                oclusores_processados: a.oclusoresProcessados, draw_calls: a.drawCalls,
                testes_obb_arvore: a.testesArvore, testes_obb_forca_bruta: a.testesForcaBruta
            };
        });
        return Benchmark.paraCSV(linhas);
    }
}

function baixaArquivo(nome, conteudo, tipo) {
    // BOM para o Excel reconhecer UTF-8
    const blob = new Blob(['﻿' + conteudo], { type: tipo || 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
