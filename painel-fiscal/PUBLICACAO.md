# Publicação do painel fiscal — GitHub Pages + Supabase

Endereço: https://tuliodubiella-arch.github.io/fechamento/painel-fiscal/

A interface está em GitHub Pages. Login e senhas ficam no Supabase Auth do mesmo projeto do fechamento. As tabelas fs_members, fs_items, fs_events e fs_attachments e o armazenamento privado fiscal-prints são exclusivos do fiscal. As tabelas do fechamento e do organograma permanecem independentes.

## Primeiro acesso

Os administradores ativos do fechamento foram vinculados inicialmente como administradores do fiscal. Eles entram com o mesmo e-mail e senha usados no fechamento. Em Equipe, podem cadastrar novas pessoas ou vincular contas existentes. Vincular uma conta existente não altera a senha nem concede acesso adicional ao fechamento.

O cadastro é processado pela função fiscal-create-member, que valida a sessão e o papel de administrador no fiscal. A chave de serviço existe somente no ambiente da função e nunca fica no navegador ou no GitHub. O arquivo public/cloud-config.js contém apenas a URL do projeto e sua chave pública.

## Arquivos e implantação

- index.html na pasta publicada é uma cópia de hosted/index.html; aponta para os arquivos em public/.
- supabase/fiscal_schema.sql registra a criação da área fiscal. Já foi aplicado; não executar novamente como se fosse uma instalação nova.
- supabase/functions/fiscal-create-member/index.ts contém a função implantada. A verificação automática de JWT legado fica desligada porque a própria função verifica a sessão em auth.getUser() e as permissões no banco, como o projeto já utiliza chaves públicas novas.
- O fluxo existente do repositório publica o GitHub Pages quando main é atualizada.
- Nenhum dado local, senha ou print real é enviado ao repositório. Os dados do teste local não são importados automaticamente para o Supabase.

## Funcionamento

O login usa Supabase Auth. As operações do banco verificam a participação na equipe e as permissões. Alterações simultâneas são detectadas pelo número de versão e pelo bloqueio da linha no banco. A interface consulta as atualizações a cada 10 segundos.

Os prints ficam em um armazenamento privado, com limite de 3 imagens por registro e 5 MB por imagem. O navegador recebe links temporários para visualizar as imagens. Ações delegadas encerram o vínculo temporário quando concluídas e geram registro de execução; reabrir mantém o histórico anterior.

O plano gratuito tem cotas compartilhadas com os demais aplicativos no mesmo projeto, incluindo espaço dos prints. A versão online precisa de conexão com a internet; não possui uma fila de alterações offline. Contas criadas somente no teste local não são contas do Supabase.

## Validação

npm test verifica o modo local e o adaptador do Supabase. supabase/fiscal_smoke_test.sql testa as operações reais do banco em uma transação que é revertida, sem deixar registros de teste. As verificações de publicação incluem respostas do servidor, recursos da página, login e layout em computador e celular.

Os arquivos Node.js e Docker continuam disponíveis para teste local ou outra hospedagem, mas não são necessários para executar a versão do GitHub Pages.
