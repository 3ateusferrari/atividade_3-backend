const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');

const app = express();
const PORTA = 3004;

app.use(express.json());

const caminhoBanco = path.join(__dirname, 'disparos.db');
const banco = new sqlite3.Database(caminhoBanco);

banco.serialize(() => {
    banco.run(`CREATE TABLE IF NOT EXISTS disparos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alarme_id INTEGER NOT NULL,
        ponto_id INTEGER,
        ponto_nome TEXT,
        tipo_disparo TEXT NOT NULL,
        timestamp_disparo DATETIME DEFAULT CURRENT_TIMESTAMP,
        resolvido BOOLEAN DEFAULT 0,
        timestamp_resolucao DATETIME,
        detalhes TEXT
    )`);
});

async function verificarStatusAlarme(idAlarme) {
    try {
        const resposta = await axios.get(`http://localhost:3003/acionamento/status/${idAlarme}`);
        return resposta.data;
    } catch (erro) {
        console.error('Erro ao verificar status do alarme:', erro.message);
        return null;
    }
}

async function validarAlarme(idAlarme) {
    try {
        const resposta = await axios.get(`http://localhost:3002/alarmes/${idAlarme}`);
        return resposta.status === 200;
    } catch (erro) {
        return false;
    }
}

async function buscarUsuariosAlarme(idAlarme) {
    try {
        const resposta = await axios.get(`http://localhost:3002/alarmes/${idAlarme}/usuarios`);
        return resposta.data;
    } catch (erro) {
        console.error('Erro ao buscar usuários do alarme:', erro.message);
        return [];
    }
}

async function enviarNotificacao(idAlarme, idUsuario, tipoEvento, detalhes) {
    try {
        await axios.post('http://localhost:3005/notificacao/enviar', {
            alarme_id: idAlarme,
            usuario_id: idUsuario,
            tipo: tipoEvento,
            mensagem: detalhes
        });
    } catch (erro) {
        console.error('Erro ao enviar notificação:', erro.message);
    }
}

async function registrarLog(idAlarme, idUsuario, tipoEvento, detalhes) {
    try {
        await axios.post('http://localhost:3006/logs', {
            alarme_id: idAlarme,
            usuario_id: idUsuario,
            tipo_evento: tipoEvento,
            detalhes: detalhes
        });
    } catch (erro) {
        console.error('Erro ao registrar log:', erro.message);
    }
}

app.post('/disparo', async (req, res) => {
    const { 
        alarme_id, 
        ponto_id, 
        ponto_nome, 
        tipo_disparo = 'movimento', 
        detalhes 
    } = req.body;
    
    if (!alarme_id) {
        return res.status(400).json({ 
            erro: 'ID do alarme é obrigatório' 
        });
    }

    const alarmeExiste = await validarAlarme(alarme_id);
    if (!alarmeExiste) {
        return res.status(404).json({ 
            erro: 'Alarme não encontrado' 
        });
    }

    const statusAlarme = await verificarStatusAlarme(alarme_id);
    if (!statusAlarme || statusAlarme.situacao !== 'ligado') {
        return res.status(409).json({ 
            erro: 'Alarme não está ativo',
            status_atual: statusAlarme ? statusAlarme.situacao : 'desconhecido'
        });
    }

    const consulta = `INSERT INTO disparos 
                        (alarme_id, ponto_id, ponto_nome, tipo_disparo, detalhes) 
                        VALUES (?, ?, ?, ?, ?)`;
    
    banco.run(consulta, [alarme_id, ponto_id, ponto_nome, tipo_disparo, detalhes], async function(erro) {
        if (erro) {
            console.error('Erro ao registrar disparo:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }

        const idDisparo = this.lastID;
        const mensagemDisparo = `ALERTA: Disparo no alarme ${alarme_id} - ${ponto_nome || 'Ponto não identificado'} - Tipo: ${tipo_disparo}`;

        await registrarLog(alarme_id, null, 'disparo', mensagemDisparo);

        const usuarios = await buscarUsuariosAlarme(alarme_id);
        for (const usuario of usuarios) {
            await enviarNotificacao(alarme_id, usuario.usuario_id, 'disparo', mensagemDisparo);
        }

        res.status(201).json({
            id: idDisparo,
            alarme_id: parseInt(alarme_id),
            ponto_id: ponto_id,
            ponto_nome,
            tipo_disparo,
            timestamp_disparo: new Date().toISOString(),
            resolvido: false,
            detalhes,
            mensagem: 'Disparo registrado e notificações enviadas'
        });
    });
});

app.get('/disparo/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    const { resolvido, limit = 50 } = req.query;
    
    const alarmeExiste = await validarAlarme(alarme_id);
    if (!alarmeExiste) {
        return res.status(404).json({ 
            erro: 'Alarme não encontrado' 
        });
    }

    let consulta = `SELECT * FROM disparos WHERE alarme_id = ?`;
    let parametros = [alarme_id];

    if (resolvido !== undefined) {
        consulta += ` AND resolvido = ?`;
        parametros.push(resolvido === 'true' ? 1 : 0);
    }

    consulta += ` ORDER BY timestamp_disparo DESC LIMIT ?`;
    parametros.push(parseInt(limit));
    
    banco.all(consulta, parametros, (erro, linhas) => {
        if (erro) {
            console.error('Erro ao buscar disparos:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        res.json(linhas);
    });
});

app.get('/disparo/ativo/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    
    const alarmeExiste = await validarAlarme(alarme_id);
    if (!alarmeExiste) {
        return res.status(404).json({ 
            erro: 'Alarme não encontrado' 
        });
    }

    const consulta = `SELECT * FROM disparos 
                   WHERE alarme_id = ? AND resolvido = 0 
                   ORDER BY timestamp_disparo DESC`;
    
    banco.all(consulta, [alarme_id], (erro, linhas) => {
        if (erro) {
            console.error('Erro ao buscar disparos ativos:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        res.json({
            alarme_id: parseInt(alarme_id),
            disparos_ativos: linhas.length,
            disparos: linhas
        });
    });
});

app.patch('/disparo/:id/resolver', async (req, res) => {
    const { id } = req.params;
    
    const consulta = `UPDATE disparos 
                        SET resolvido = 1, timestamp_resolucao = CURRENT_TIMESTAMP 
                        WHERE id = ?`;
    
    banco.run(consulta, [id], async function(erro) {
        if (erro) {
            console.error('Erro ao resolver disparo:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                erro: 'Disparo não encontrado' 
            });
        }

        const consultaBusca = `SELECT * FROM disparos WHERE id = ?`;
        banco.get(consultaBusca, [id], async (erro, linha) => {
            if (!erro && linha) {
                await registrarLog(linha.alarme_id, null, 'disparo_resolvido', 
                    `Disparo ${id} foi marcado como resolvido`);
            }
        });
        
        res.json({
            id: parseInt(id),
            resolvido: true,
            timestamp_resolucao: new Date().toISOString(),
            mensagem: 'Disparo marcado como resolvido'
        });
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        servico: 'controle-disparo',
        horario: new Date().toISOString() 
    });
});

app.use((erro, req, res, next) => {
    console.error('Erro no serviço de disparo:', erro);
    res.status(500).json({ 
        erro: 'Erro interno do servidor' 
    });
});

app.listen(PORTA, () => {
    console.log(`Serviço de Controle de Disparo rodando na porta ${PORTA}`);
});

process.on('SIGINT', () => {
    console.log('Fechando conexão com o banco de dados...');
    banco.close((erro) => {
        if (erro) {
            console.error('Erro ao fechar banco:', erro);
        } else {
            console.log('Conexão com banco fechada.');
        }
        process.exit(0);
    });
});
