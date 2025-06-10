// cadastro-usuarios/server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

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
        data_cadastro DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

app.post('/usuarios', (req, res) => {
    const { nome, celular, email } = req.body;
    
    if (!nome || !celular) {
        return res.status(400).json({ 
            erro: 'Nome e celular são obrigatórios' 
        });
    }

    const consulta = `INSERT INTO usuarios (nome, celular, email) VALUES (?, ?, ?)`;
    
    banco.run(consulta, [nome, celular, email], function(erro) {
        if (erro) {
            if (erro.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ 
                    erro: 'Celular já cadastrado' 
                });
            }
            console.error('Erro ao criar usuário:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        res.status(201).json({
            id: this.lastID,
            nome,
            celular,
            email,
            mensagem: 'Usuário criado com sucesso'
        });
    });
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

app.put('/usuarios/:id', (req, res) => {
    const { id } = req.params;
    const { nome, celular, email } = req.body;
    
    if (!nome || !celular) {
        return res.status(400).json({ 
            erro: 'Nome e celular são obrigatórios' 
        });
    }

    const consulta = `UPDATE usuarios SET nome = ?, celular = ?, email = ? WHERE id = ?`;
    
    banco.run(consulta, [nome, celular, email, id], function(erro) {
        if (erro) {
            if (erro.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ 
                    erro: 'Celular já cadastrado para outro usuário' 
                });
            }
            console.error('Erro ao atualizar usuário:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                erro: 'Usuário não encontrado' 
            });
        }
        
        res.json({
            id: parseInt(id),
            nome,
            celular,
            email,
            mensagem: 'Usuário atualizado com sucesso'
        });
    });
});

app.delete('/usuarios/:id', (req, res) => {
    const { id } = req.params;
    const consulta = `DELETE FROM usuarios WHERE id = ?`;
    
    banco.run(consulta, [id], function(erro) {
        if (erro) {
            console.error('Erro ao deletar usuário:', erro);
            return res.status(500).json({ 
                erro: 'Erro interno do servidor' 
            });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ 
                erro: 'Usuário não encontrado' 
            });
        }
        
        res.json({ 
            mensagem: 'Usuário deletado com sucesso' 
        });
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
