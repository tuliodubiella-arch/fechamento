# Painel Fiscal — Grupo Cavalca

Versão local para validar o fluxo com a equipe antes de publicar. Identidade baseada no guia do Grupo Cavalca: logo oficial sem alterações, Raleway, laranja #F7AE14 e cinzas institucionais.

## Abrir para teste

1. Instale Node.js 22 ou superior, caso ainda não esteja instalado.
2. No Windows, abra `iniciar.cmd`. Alternativamente, execute `npm start` (ou `node server.mjs`) na pasta do projeto. Não há dependências para instalar.
3. Abra http://localhost:4273.
4. No primeiro acesso, cadastre seu nome, e-mail e senha de pelo menos 10 caracteres. Essa conta será administradora. Você pode incluir exemplos fictícios ou iniciar com o painel vazio.
5. Em **Equipe**, cadastre as pessoas e suas senhas iniciais. As contas podem acessar as mesmas rotinas, projetos e comentários.

## O que está disponível

- Visão geral: indicadores, próximas entregas e movimentações recentes.
- Rotinas e projetos: título, objetivo, responsável, prioridade, frequência e período de execução.
- Atividades: cadastro e conclusão, com cálculo automático do progresso.
- Ações delegadas: o dono ou administrador atribui ações com prazo a outras pessoas. O vínculo temporário fica ativo enquanto a pessoa tiver ações pendentes naquela entrega. O responsável pela ação, dono ou administrador pode concluir com descrição do resultado, gerando registro de execução. Reabrir a ação reativa o vínculo e preserva o histórico anterior.
- Os quadros mostram participantes temporários e o filtro **Minhas ações pendentes**. A busca também encontra participantes ativos. A delegação não altera o dono nem o status geral da entrega.
- Cronograma: visualização por período e edição das datas.
- Comentários: conversa compartilhada com autor e horário.
- Prints: selecione arquivos ou cole imagens com Ctrl+V nos comentários, registros de execução e resultados das ações delegadas. Veja a prévia, remova antes de salvar e abra os anexos salvos em tamanho original. Limite de 3 prints por registro, de até 5 MB cada, em PNG, JPG ou WebP. Uma descrição do registro continua obrigatória. As imagens ficam em `data/attachments/`, com acesso restrito às contas da equipe; faça backup de toda a pasta `data/`.
- Execuções: registro descritivo de cada execução, com autor e horário.
- Equipe: criação de contas pelo administrador.
- Histórico: movimentações do time com identificação de autoria.

Os dados ficam no servidor em `data/database.json`; não ficam somente no navegador. A página atualiza os dados a cada 10 segundos quando não há formulário em edição. Atualizações simultâneas do mesmo registro são detectadas para evitar sobrescrita. A frequência é informativa: novas datas e ciclos devem ser ajustados manualmente. Concluir uma atividade atualiza o progresso; o status geral da entrega é controlado pela equipe.

## Acesso de outras pessoas no teste

Por padrão o servidor aceita acesso somente neste computador. Para um teste na rede interna, configure `HOST=0.0.0.0` e inicie o servidor; os demais computadores acessam o IP deste computador na porta 4273, conforme a liberação da rede e do firewall. O teste usa HTTP. Para acesso pela internet, use HTTPS e configure `COOKIE_SECURE=true`.

As senhas são armazenadas com salt e scrypt. A sessão usa cookie HttpOnly, expira após oito horas e é encerrada ao reiniciar o servidor. Há limite de tentativas de login. Não há recuperação de senha por e-mail nesta versão. As contas de equipe podem editar todas as entregas; apenas o administrador cadastra pessoas.

## Publicação no GitHub

O projeto está preparado para ser enviado a um repositório; nenhuma publicação foi realizada. `data/` está excluída pelo `.gitignore`: não publique dados reais, contas ou senhas no repositório.

GitHub Pages serve arquivos estáticos e não executa este servidor. Para manter login e colaboração, publique o código no GitHub e hospede o aplicativo em um serviço que execute Node.js, com HTTPS e armazenamento persistente para `data/`. Antes da publicação, configure domínio, volume persistente, backups e a conta administrativa em ambiente privado. Não basta enviar apenas a pasta `public/` ao GitHub Pages.

Esta versão é adequada à validação local de uma equipe pequena em um único processo. Para operação com várias instâncias, migrar dados e sessões para banco compartilhado. As sessões em memória não sobrevivem a reinícios. Faça backup da pasta `data/` com o servidor parado. Os exemplos não representam obrigações tributárias ou prazos legais.

## Verificação

Execute `npm test`. O teste usa armazenamento temporário separado e verifica autenticação, cadastro de equipe, permissões, atividades, comentários, execuções, conflitos de edição e persistência após reinício.
