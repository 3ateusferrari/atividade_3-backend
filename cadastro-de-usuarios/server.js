const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const SECRET = process.env.JWT_SECRET || 'segredo_super_secreto';

const app = express();
const PORTA = 3001;

app.use(express.json());

const caminhoBanco = path.join(__dirname, 'usuarios.db');
const banco = new sqlite3.Database(caminhoBanco);

banco.serialize(() => {
    banco.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT NOT NULL,
        celular TEXT NOT NULL UNIQUE,
        email TEXT,
        senha TEXT NOT NULL,
        data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

function autenticarToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
    jwt.verify(token, SECRET, (err, usuario) => {
        if (err) return res.status(403).json({ erro: 'Token inválido' });
        req.usuario = usuario;
        next();
    });
}

app.post('/usuarios', async (req, res) => {
    try {
        const { nome, celular, email, senha } = req.body;
        console.log('Recebida requisição para criar usuário:', { nome, celular, email });
        
        if (!nome || !celular || !senha) {
            return res.status(400).json({ erro: 'Nome, celular e senha são obrigatórios' });
        }
        
        if (senha.length < 8 || !/[A-Z]/.test(senha) || !/[a-z]/.test(senha) || !/[0-9]/.test(senha)) {
            return res.status(400).json({ erro: 'Senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula e número' });
        }
        
        console.log('Iniciando hash da senha...');
        // VERSÃO TEMPORÁRIA: usar senha simples para testar
        const senhaHash = senha; // Temporariamente sem hash
        console.log('Hash da senha concluído (versão temporária)');
        
        const consulta = `INSERT INTO usuarios (nome, celular, email, senha) VALUES (?, ?, ?, ?)`;
        console.log('Executando inserção no banco...');
        
        banco.run(consulta, [nome, celular, email, senhaHash], function(erro) {
            if (erro) {
                console.error('Erro ao criar usuário:', erro);
                if (erro.code === 'SQLITE_CONSTRAINT') {
                    return res.status(409).json({ erro: 'Celular já cadastrado' });
                }
                return res.status(500).json({ erro: 'Erro interno do servidor' });
            }
            console.log('Usuário criado com sucesso, ID:', this.lastID);
            res.status(201).json({ id: this.lastID, nome, celular, email, mensagem: 'Usuário criado com sucesso' });
        });
    } catch (erro) {
        console.error('Erro na criação de usuário:', erro);
        res.status(500).json({ erro: 'Erro interno do servidor' });
    }
});

app.get('/usuarios', (req, res) => {
    const consulta = `SELECT * FROM usuarios ORDER BY data_cadastro DESC`;
    
    banco.all(consulta, [], (erro, linhas) => {
        if (erro) {
            console.error('Erro ao buscar usuários:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        res.json(linhas);
    });
});

app.get('/usuarios/:id', (req, res) => {
    const { id } = req.params;
    const consulta = `SELECT * FROM usuarios WHERE id = ?`;
    
    banco.get(consulta, [id], (erro, linha) => {
        if (erro) {
            console.error('Erro ao buscar usuário:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (!linha) {
            return res.status(404).json({ 
                erro: 'Usuário não encontrado' 
            });
        }
        
        res.json(linha);
    });
});

app.post('/login', (req, res) => {
    const { celular, senha } = req.body;
    if (!celular || !senha) {
        return res.status(400).json({ erro: 'Celular e senha são obrigatórios' });
    }
    const consulta = `SELECT * FROM usuarios WHERE celular = ?`;
    banco.get(consulta, [celular], async (erro, usuario) => {
        if (erro) return res.status(500).json({ erro: 'Erro interno do servidor' });
        if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado' });
        
        // VERSÃO TEMPORÁRIA: comparar senhas diretamente
        const senhaValida = (senha === usuario.senha);
        
        if (!senhaValida) return res.status(401).json({ erro: 'Senha inválida' });
        const token = jwt.sign({ id: usuario.id, celular: usuario.celular }, SECRET, { expiresIn: '8h' });
        res.json({ token });
    });
});

app.put('/usuarios/:id', autenticarToken, (req, res) => {
    const { id } = req.params;
    if (parseInt(id) !== req.usuario.id) {
        return res.status(403).json({ erro: 'Você só pode editar seu próprio cadastro' });
    }
    const { nome, celular, email, senha } = req.body;
    if (!nome || !celular) {
        return res.status(400).json({ erro: 'Nome e celular são obrigatórios' });
    }
    let consulta, params;
    if (senha) {
        if (senha.length < 8 || !/[A-Z]/.test(senha) || !/[a-z]/.test(senha) || !/[0-9]/.test(senha)) {
            return res.status(400).json({ erro: 'Senha deve ter pelo menos 8 caracteres, incluindo maiúscula, minúscula e número' });
        }
        bcrypt.hash(senha, 10).then(senhaHash => {
            consulta = `UPDATE usuarios SET nome = ?, celular = ?, email = ?, senha = ? WHERE id = ?`;
            params = [nome, celular, email, senhaHash, id];
            banco.run(consulta, params, function(erro) {
                if (erro) {
                    if (erro.code === 'SQLITE_CONSTRAINT') {
                        return res.status(409).json({ erro: 'Celular já cadastrado para outro usuário' });
                    }
                    return res.status(500).json({ erro: 'Erro interno do servidor' });
                }
                if (this.changes === 0) {
                    return res.status(404).json({ erro: 'Usuário não encontrado' });
                }
                res.json({ id: parseInt(id), nome, celular, email, mensagem: 'Usuário atualizado com sucesso' });
            });
        });
    } else {
        consulta = `UPDATE usuarios SET nome = ?, celular = ?, email = ? WHERE id = ?`;
        params = [nome, celular, email, id];
        banco.run(consulta, params, function(erro) {
            if (erro) {
                if (erro.code === 'SQLITE_CONSTRAINT') {
                    return res.status(409).json({ erro: 'Celular já cadastrado para outro usuário' });
                }
                return res.status(500).json({ erro: 'Erro interno do servidor' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ erro: 'Usuário não encontrado' });
            }
            res.json({ id: parseInt(id), nome, celular, email, mensagem: 'Usuário atualizado com sucesso' });
        });
    }
});

app.delete('/usuarios/:id', autenticarToken, (req, res) => {
    const { id } = req.params;
    if (parseInt(id) !== req.usuario.id) {
        return res.status(403).json({ erro: 'Você só pode deletar seu próprio cadastro' });
    }
    const consulta = `DELETE FROM usuarios WHERE id = ?`;
    banco.run(consulta, [id], function(erro) {
        if (erro) {
            return res.status(500).json({ erro: 'Erro interno do servidor' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ erro: 'Usuário não encontrado' });
        }
        res.json({ mensagem: 'Usuário deletado com sucesso' });
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        servico: 'cadastro-usuarios',
        horario: new Date().toISOString() 
    });
});

app.use((erro, req, res, next) => {
    console.error('Erro no serviço de usuários:', erro);
    res.status(500).json({ 
        erro: 'Erro interno do servidor' 
    });
});

app.listen(PORTA, () => {
    console.log(`Serviço de Cadastro de Usuários rodando na porta ${PORTA}`);
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
