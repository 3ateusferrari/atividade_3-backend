const express = require('express');
const axios = require('axios');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORTA = 3003;
const SECRET = process.env.JWT_SECRET || 'segredo_super_secreto';

app.use(cors());
app.use(express.json());

// Middleware de log
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const statusAlarmes = {};

function autenticarToken(req, res, next) {
    if (req.path === '/health') return next();
    
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        console.log('[AUTH] Token não fornecido');
        return res.status(401).json({ erro: 'Token não fornecido' });
    }
    
    jwt.verify(token, SECRET, (err, usuario) => {
        if (err) {
            console.log('[AUTH] Token inválido:', err.message);
            return res.status(403).json({ erro: 'Token inválido' });
        }
        req.usuario = usuario;
        console.log('[AUTH] Usuário autenticado:', usuario.id);
        next();
    });
}

app.use(autenticarToken);

async function verificarVinculoUsuario(req, res, next) {
    const usuarioId = req.usuario.id;
    const alarmeId = req.params.id_alarme;
    
    console.log(`[PERMISSAO] Verificando permissão - Usuário: ${usuarioId}, Alarme: ${alarmeId}`);
    
    try {
        // Primeira tentativa: buscar o alarme específico
        const respostaAlarme = await axios.get(`http://localhost:3002/alarmes/${alarmeId}`, {
            timeout: 5000,
            headers: {
                'authorization': req.headers['authorization']
            }
        });
        
        console.log('[PERMISSAO] Dados do alarme:', respostaAlarme.data);
        
        // Verifica se o alarme existe
        if (!respostaAlarme.data) {
            console.log('[PERMISSAO] Alarme não encontrado');
            return res.status(404).json({ erro: 'Alarme não encontrado' });
        }
        
        // Verifica se o usuário é dono do alarme
        if (respostaAlarme.data.usuario_id && respostaAlarme.data.usuario_id.toString() === usuarioId.toString()) {
            console.log('[PERMISSAO] Usuário é dono do alarme - Acesso permitido');
            return next();
        }
        
        // Tentativa alternativa: verificar rota de permissão específica
        try {
            const respostaPermissao = await axios.get(
                `http://localhost:3002/alarmes/${alarmeId}/permissao/${usuarioId}`,
                {
                    timeout: 5000,
                    headers: {
                        'authorization': req.headers['authorization']
                    }
                }
            );
            
            console.log('[PERMISSAO] Resposta da verificação de permissão:', respostaPermissao.data);
            
            if (respostaPermissao.data && respostaPermissao.data.autorizado) {
                console.log('[PERMISSAO] Acesso autorizado via rota de permissão');
                return next();
            }
        } catch (erroPermissao) {
            console.log('[PERMISSAO] Rota de permissão não disponível:', erroPermissao.message);
        }
        
        // Se chegou até aqui, não tem permissão
        console.log('[PERMISSAO] Usuário não tem permissão para este alarme');
        return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
        
    } catch (erro) {
        console.error('[PERMISSAO] Erro ao verificar permissão:', erro.message);
        
        if (erro.response) {
            console.log('[PERMISSAO] Status da resposta:', erro.response.status);
            console.log('[PERMISSAO] Dados da resposta:', erro.response.data);
            
            if (erro.response.status === 404) {
                return res.status(404).json({ erro: 'Alarme não encontrado' });
            }
        }
        
        return res.status(403).json({ erro: 'Usuário não tem permissão para este alarme' });
    }
}

app.post('/acionar/:id_alarme', verificarVinculoUsuario, async (req, res) => {
    const { id_alarme } = req.params;
    const usuarioId = req.usuario.id;
    
    console.log(`[ACIONAMENTO] Tentando armar alarme ${id_alarme} para usuário ${usuarioId}`);
    
    try {
        // Busca dados do alarme
        const alarme = await axios.get(`http://localhost:3002/alarmes/${id_alarme}`, {
            headers: {
                'authorization': req.headers['authorization']
            }
        });
        
        if (!alarme.data) {
            return res.status(404).json({ erro: 'Alarme não encontrado' });
        }
        
        // Atualiza status do alarme
        statusAlarmes[id_alarme] = 'ligado';
        
        // Registra log
        try {
            await axios.post('http://localhost:3006/logs', {
                alarme_id: id_alarme,
                usuario_id: usuarioId,
                tipo_evento: 'acionamento',
                detalhes: 'Alarme armado',
                timestamp: new Date().toISOString()
            }, {
                timeout: 5000,
                headers: {
                    'authorization': req.headers['authorization']
                }
            });
        } catch (erroLog) {
            console.error('[ACIONAMENTO] Erro ao registrar log:', erroLog.message);
        }
        
        // Envia notificação
        try {
            await axios.post('http://localhost:3005/notificacao/enviar', {
                alarme_id: id_alarme,
                usuario_id: usuarioId,
                tipo: 'acionamento',
                mensagem: 'O alarme foi armado.',
                timestamp: new Date().toISOString()
            }, {
                timeout: 5000,
                headers: {
                    'authorization': req.headers['authorization']
                }
            });
        } catch (erroNotificacao) {
            console.error('[ACIONAMENTO] Erro ao enviar notificação:', erroNotificacao.message);
        }
        
        console.log(`[ACIONAMENTO] Alarme ${id_alarme} armado com sucesso`);
        res.json({ 
            id_alarme, 
            situacao: 'ligado', 
            mensagem: 'Alarme armado com sucesso',
            timestamp: new Date().toISOString()
        });
        
    } catch (erro) {
        console.error('[ACIONAMENTO] Erro ao armar alarme:', erro.message);
        res.status(500).json({ erro: 'Erro ao armar alarme', detalhes: erro.message });
    }
});

app.post('/desarmar/:id_alarme', verificarVinculoUsuario, async (req, res) => {
    const { id_alarme } = req.params;
    const usuarioId = req.usuario.id;
    
    console.log(`[DESARMAMENTO] Tentando desarmar alarme ${id_alarme} para usuário ${usuarioId}`);
    
    try {
        // Busca dados do alarme
        const alarme = await axios.get(`http://localhost:3002/alarmes/${id_alarme}`, {
            headers: {
                'authorization': req.headers['authorization']
            }
        });
        
        if (!alarme.data) {
            return res.status(404).json({ erro: 'Alarme não encontrado' });
        }
        
        // Atualiza status do alarme
        statusAlarmes[id_alarme] = 'desligado';
        
        // Registra log
        try {
            await axios.post('http://localhost:3006/logs', {
                alarme_id: id_alarme,
                usuario_id: usuarioId,
                tipo_evento: 'desarmamento',
                detalhes: 'Alarme desarmado',
                timestamp: new Date().toISOString()
            }, {
                timeout: 5000,
                headers: {
                    'authorization': req.headers['authorization']
                }
            });
        } catch (erroLog) {
            console.error('[DESARMAMENTO] Erro ao registrar log:', erroLog.message);
        }
        
        // Envia notificação
        try {
            await axios.post('http://localhost:3005/notificacao/enviar', {
                alarme_id: id_alarme,
                usuario_id: usuarioId,
                tipo: 'desarmamento',
                mensagem: 'O alarme foi desarmado.',
                timestamp: new Date().toISOString()
            }, {
                timeout: 5000,
                headers: {
                    'authorization': req.headers['authorization']
                }
            });
        } catch (erroNotificacao) {
            console.error('[DESARMAMENTO] Erro ao enviar notificação:', erroNotificacao.message);
        }
        
        console.log(`[DESARMAMENTO] Alarme ${id_alarme} desarmado com sucesso`);
        res.json({ 
            id_alarme, 
            situacao: 'desligado', 
            mensagem: 'Alarme desarmado com sucesso',
            timestamp: new Date().toISOString()
        });
        
    } catch (erro) {
        console.error('[DESARMAMENTO] Erro ao desarmar alarme:', erro.message);
        res.status(500).json({ erro: 'Erro ao desarmar alarme', detalhes: erro.message });
    }
});

app.get('/status/:id_alarme', verificarVinculoUsuario, (req, res) => {
    const { id_alarme } = req.params;
    const situacao = statusAlarmes[id_alarme] || 'desligado';
    
    console.log(`[STATUS] Consultando status do alarme ${id_alarme}: ${situacao}`);
    
    res.json({ 
        id_alarme, 
        situacao,
        timestamp: new Date().toISOString()
    });
});

app.get('/status', (req, res) => {
    console.log('[STATUS] Consultando status de todos os alarmes');
    res.json({
        alarmes: statusAlarmes,
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        servico: 'controle-acionamento', 
        horario: new Date().toISOString(),
        alarmes_ativos: Object.keys(statusAlarmes).length
    });
});

// Middleware de tratamento de erros
app.use((erro, req, res, next) => {
    console.error('[ERRO] Erro não capturado:', erro);
    if (!res.headersSent) {
        res.status(500).json({ 
            erro: 'Erro interno do servidor',
            mensagem: erro.message
        });
    }
});

app.listen(PORTA, () => {
    console.log(`Serviço de Controle de Acionamento rodando na porta ${PORTA}`);
    console.log('Endpoints disponíveis:');
    console.log('  POST /acionar/:id_alarme - Armar alarme');
    console.log('  POST /desarmar/:id_alarme - Desarmar alarme');
    console.log('  GET /status/:id_alarme - Status de um alarme');
    console.log('  GET /status - Status de todos os alarmes');
    console.log('  GET /health - Health check');
});