const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = express();
const PORTA = 3004;
const SECRET = process.env.JWT_SECRET || 'segredo_super_secreto';

app.use(express.json());

app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
    next();
});

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

function autenticarToken(req, res, next) {
    if (req.path === '/health' || req.path === '/') return next();
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
    jwt.verify(token, SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Token inválido' });
        req.usuario = usuario;
        next();
    });
}

app.use(autenticarToken);

async function verificarVinculoUsuario(req, res, next) {
    console.log('=== VERIFICAÇÃO DE VÍNCULO ===');
    console.log('Body recebido:', req.body);
    console.log('Usuario do token:', req.usuario);
    
    const usuarioId = req.usuario.id;
    const alarmeId = req.body?.alarme_id;
    
    if (!alarmeId) {
        console.log('Erro: ID do alarme não fornecido no body');
        return res.status(400).json({ erro: 'ID do alarme é obrigatório' });
    }
    
    try {
        console.log(`Verificando permissão: usuário ${usuarioId} no alarme ${alarmeId}`);
        
        // Pegar o token original da requisição
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        
        const resposta = await axios.get(`http://localhost:3002/alarmes/${alarmeId}/permissao/${usuarioId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        console.log('Resposta da verificação:', resposta.data);
        
        if (!resposta.data.autorizado) {
            console.log('Usuário não autorizado');
            return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
        }
        
        console.log('Usuário autorizado, continuando...');
        next();
    } catch (error) {
        console.error('Erro na verificação de permissão:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Dados:', error.response.data);
        }
        return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
    }
}

async function verificarStatusAlarme(idAlarme, token) {
    try {
        console.log(`Verificando status do alarme ${idAlarme}...`);
        console.log('Token usado:', token ? token.substring(0, 20) + '...' : 'null');
        
        const resposta = await axios.get(`http://localhost:3003/acionamento/status/${idAlarme}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        console.log(`Status do alarme ${idAlarme}:`, resposta.data);
        return resposta.data;
    } catch (erro) {
        console.error(`Erro ao verificar status do alarme ${idAlarme}:`, erro.message);
        if (erro.response) {
            console.error('Status:', erro.response.status);
            console.error('Dados:', erro.response.data);
        }
        return null;
    }
}

async function validarAlarme(idAlarme, authHeader) {
    try {
        console.log(`Validando alarme ${idAlarme}...`);
        
        // Extrair apenas o token do header Authorization
        const token = authHeader && authHeader.split(' ')[1];
        console.log('Token extraído:', token ? token.substring(0, 20) + '...' : 'null');
        
        const resposta = await axios.get(`http://localhost:3002/alarmes/${idAlarme}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        console.log(`Alarme ${idAlarme} validado com sucesso`);
        return resposta.status === 200;
    } catch (erro) {
        console.error(`Erro ao validar alarme ${idAlarme}:`, erro.message);
        if (erro.response) {
            console.error('Status:', erro.response.status);
            console.error('Dados:', erro.response.data);
        }
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

// Rota raiz
app.get('/', (req, res) => {
    res.json({ 
        servico: 'controle-disparo',
        versao: '1.0.0',
        porta: PORTA,
        rotas_disponivel: {
            'POST /disparo': 'Criar novo disparo',
            'GET /disparo/:alarme_id': 'Buscar disparos de um alarme',
            'GET /disparo/ativo/:alarme_id': 'Buscar disparos ativos',
            'PATCH /disparo/:id/resolver': 'Resolver um disparo',
            'GET /health': 'Status do serviço'
        }
    });
});

// Se alguém tentar fazer POST na raiz
app.post('/', (req, res) => {
    res.status(405).json({ 
        erro: 'Método não permitido na raiz',
        sugestao: 'Use POST /disparo para criar um disparo'
    });
});

app.post('/disparo', verificarVinculoUsuario, async (req, res) => {
    try {
        console.log('=== INÍCIO DO DISPARO ===');
        console.log('Body recebido:', req.body);
        
        const { 
            alarme_id, 
            ponto_id, 
            ponto_nome, 
            tipo_disparo = 'movimento', 
            detalhes 
        } = req.body;
        
        if (!alarme_id) {
            console.log('Erro: ID do alarme não fornecido');
            return res.status(400).json({ 
                erro: 'ID do alarme é obrigatório' 
            });
        }

        console.log('Verificando se alarme existe...');
        console.log('Token sendo usado:', req.headers['authorization']);
        const alarmeExiste = await validarAlarme(alarme_id, req.headers['authorization']);
        console.log('Alarme existe:', alarmeExiste);
        
        if (!alarmeExiste) {
            console.log('Erro: Alarme não encontrado');
            return res.status(404).json({ 
                erro: 'Alarme não encontrado' 
            });
        }

        console.log('Verificando status do alarme...');
        const token = req.headers['authorization'] && req.headers['authorization'].split(' ')[1];
        const statusAlarme = await verificarStatusAlarme(alarme_id, token);
        console.log('Status do alarme:', statusAlarme);
        
        if (!statusAlarme || statusAlarme.situacao !== 'ligado') {
            console.log('Erro: Alarme não está ativo');
            return res.status(409).json({ 
                erro: 'Alarme não está ativo',
                status_atual: statusAlarme ? statusAlarme.situacao : 'desconhecido'
            });
        }

        console.log('Inserindo disparo no banco...');
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

            console.log('Disparo registrado com sucesso, ID:', this.lastID);
            const idDisparo = this.lastID;
            const mensagemDisparo = `ALERTA: Disparo no alarme ${alarme_id} - ${ponto_nome || 'Ponto não identificado'} - Tipo: ${tipo_disparo}`;

            console.log('Registrando log...');
            await registrarLog(alarme_id, null, 'disparo', mensagemDisparo);

            console.log('Buscando usuários do alarme...');
            const usuarios = await buscarUsuariosAlarme(alarme_id);
            console.log('Usuários encontrados:', usuarios);
            
            console.log('Enviando notificações...');
            for (const usuario of usuarios) {
                await enviarNotificacao(alarme_id, usuario.usuario_id, 'disparo', mensagemDisparo);
            }

            console.log('=== DISPARO CONCLUÍDO COM SUCESSO ===');
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
    } catch (error) {
        console.error('Erro geral no disparo:', error);
        res.status(500).json({ 
            erro: 'Erro interno do servidor',
            detalhes: error.message
        });
    }
});

app.get('/disparo/:alarme_id', async (req, res) => {
    const { alarme_id } = req.params;
    const { resolvido, limit = 50 } = req.query;
    
    const alarmeExiste = await validarAlarme(alarme_id, req.headers['authorization']);
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
    
    const alarmeExiste = await validarAlarme(alarme_id, req.headers['authorization']);
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