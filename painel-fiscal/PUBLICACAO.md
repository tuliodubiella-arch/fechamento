# Publicação do painel fiscal

O código pode ficar no GitHub. O aplicativo requer um servidor Node.js 22 ou superior ou uma hospedagem de containers Docker, com HTTPS e volume persistente. GitHub Pages não executa o servidor.

## Configuração do serviço

- Comando para iniciar: `node server.mjs` ou `npm start`.
- Variáveis: `NODE_ENV=production`, `HOST=0.0.0.0`, `COOKIE_SECURE=true` e `DATA_DIR` apontando para o volume persistente.
- Use a porta indicada pelo serviço em `PORT`.
- Configure `SETUP_TOKEN` com um código secreto aleatório de pelo menos 32 caracteres. Esse código será solicitado no primeiro acesso para criar o administrador; evita que um visitante se cadastre antes da equipe. Não grave o código no repositório.
- No Docker, monte o volume em `/data`, com permissão de escrita para o usuário `node`.
- Execute uma única instância do servidor: dados são gravados em arquivo e sessões ficam em memória.

## Dados e publicação

Não enviar `data/`, `.env`, senhas, prints reais ou arquivos de teste ao GitHub. Uma instalação nova começa vazia; os dados do teste local não são publicados automaticamente. Mantenha backup da pasta de dados inteira, incluindo `attachments/`.

No primeiro acesso ao endereço publicado, informe o código de configuração, crie a conta administrativa e cadastre a equipe. Depois desse cadastro, o primeiro acesso fica fechado. Reinícios encerram as sessões e exigem novo login.

Antes de compartilhar o endereço, confirmar HTTPS, volume persistente e o cadastro do administrador. Verificar cadastro de rotina, comentário com print e acesso com uma segunda conta. Recuperação de senha por e-mail ainda não está disponível.
