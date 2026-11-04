# Publicação do painel fiscal — GitHub Pages + Supabase

Endereço: https://tuliodubiella-arch.github.io/fechamento/painel-fiscal/

A interface está em GitHub Pages. Login e senhas ficam no Supabase Auth do mesmo projeto do fechamento. As tabelas fs_members, fs_items, fs_events e fs_attachments e o armazenamento privado fiscal-prints são exclusivos do fiscal. As tabelas do fechamento e do organograma permanecem independentes.

## Primeiro acesso

Os administradores ativos do fechamento foram vinculados inicialmente como administradores do fiscal. Eles entram com o mesmo e-mail e senha usados no fechamento. Em Equipe, podem cadastrar novas pessoas ou vincular contas existentes. Vincular uma conta existente não altera a senha nem concede acesso adicional ao fechamento.

O cadastro é processado pela função fiscal-create-member, que valida a sessão e o papel de administrador no fiscal. A chave de serviço existe somente no ambiente da função e nunca fica no navegador ou no GitHub. O arquivo public/cloud-config.js contém apenas a URL do projeto e sua chave pública.

## Arquivos e implantação

- index.html na pasta publicada é uma cópia de hosted/index.html; aponta para os arquivos em public/.
- supabase/fiscal_schema.sql registra a criação da área fiscal. Já foi aplicado; não executar novamente como se fosse uma instalação nova.
- supabase/fiscal_groups.sql cria fs_groups e as operações de grupos, registros e etapas. Já foi aplicado. Os registros continuam em fs_items e usam os mesmos comentários, execuções, delegações e prints; rotinas existentes permanecem sem grupo até serem vinculadas pela equipe.
- supabase/fiscal_activity_actions.sql e supabase/fiscal_item_actions.sql adicionam as exclusões administrativas. Já foram aplicados. Rotinas e projetos excluídos ficam preservados com deleted_at e deleted_by, mas saem dos quadros e não aceitam novas edições. Os prints permanecem no armazenamento privado.
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


## Reuniões de rotina e convites

A primeira versão usa atas digitadas, conforme a escolha do grupo. Pauta, ata, resumo, decisões e ações são preenchidos pela equipe. Ao finalizar, todas as ações com responsável, início e prazo viram rotinas únicas, vinculadas à reunião. Rascunhos não criam rotinas. A finalização é atômica e idempotente; a ata finalizada mantém acompanhamentos posteriores. As atas compartilhadas estão em `fs_meetings`, protegidas pela participação ativa na equipe.

Aplicar `supabase/fiscal_meetings.sql` uma única vez e implantar `supabase/functions/fiscal-invite-member/index.ts`. A função verifica a identidade no Supabase Auth e o perfil de administrador do fiscal a cada chamada. Não usa chave de serviço no navegador. O envio utiliza o serviço de e-mail já configurado no Supabase. Em Authentication > URL Configuration, manter o endereço https://tuliodubiella-arch.github.io/fechamento/painel-fiscal/ autorizado nos redirecionamentos. Contas novas recebem convite para definir a senha. Contas existentes recebem um link de acesso e mantêm a senha atual. A tela Equipe mantém o cadastro direto como alternativa.

Os testes de e-mail usam um transporte simulado e não disparam convites reais. O envio real depende da configuração e das cotas do provedor de e-mail do projeto.


## Importação de atas

A tela Reuniões permite importar o conteúdo de atas DOCX, PDF com texto e TXT de até 10 MB. O documento é lido no navegador. A biblioteca Mammoth 1.10.0 lê o Word e PDF.js 4.10.38 lê o PDF; os recursos públicos são carregados sob demanda do jsDelivr com versões fixas e verificação de integridade. Não há envio do documento para uma API de IA. O texto é salvo no banco apenas quando o usuário salva ou finaliza a ata. O arquivo original não é arquivado por este importador.

A identificação de ações usa tabelas e rótulos como Ação, Responsável e Prazo, além de listas de encaminhamentos. Nomes são vinculados somente a usuários cadastrados quando a correspondência é única; prazos sem ano, datas inválidas ou responsáveis ambíguos ficam para revisão. A prévia permite selecionar ações, acrescentar ou substituir o texto, cancelar sem alterar o formulário e evitar repetir ações já incluídas. PDFs digitalizados sem texto não são processados por OCR nesta versão. Limites: 100 páginas por PDF, 50.000 caracteres na ata e 100 ações por reunião.


Atas extensas: o leitor aceita até 1 milhão de caracteres, mantendo o limite de 10 MB e 100 páginas de PDF. Acima de 50.000 caracteres, a prévia oferece partes de até 45.000 caracteres para seleção. Somente a parte escolhida é incluída na ata; o original e as demais partes não são arquivados automaticamente. O texto da prévia pode ser editado, exigindo atualizar as sugestões antes de incluir. Cada reunião continua limitada a 50.000 caracteres no texto salvo.
