# Fechamento contábil

Painel claro e instalável para a execução mensal das contas por empresa. A interface fica em `https://tuliodubiella-arch.github.io/fechamento/`; autenticação, dados e permissões ficam no projeto Supabase da conta do administrador, separado do painel antigo. Nenhuma informação contábil deve ser publicada no GitHub.

## Ativação

1. No projeto Supabase `jbnqgchofaprjjwbuzpe`, execute `supabase/closing_schema.sql` no SQL Editor.
2. Importe uma única vez os dados históricos e atuais com o arquivo privado de migração, guardado fora do repositório. Não copie esse arquivo para o GitHub.
3. Crie ou localize o usuário administrador em **Authentication → Users** e vincule seu ID a `fc_members`, marcando `is_admin = true`. O administrador deve definir sua senha pela página de recuperação ou pelo convite da conta, sem compartilhar senha.
4. Implante `supabase/functions/fc-invite-member/index.ts` como Edge Function `fc-invite-member`. Desative **Verify JWT with legacy secret** nas configurações dessa função: o código valida a sessão do usuário e o perfil de administrador. As variáveis `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidas pelo Supabase à função. A chave de serviço nunca vai para o navegador ou GitHub.
5. Em **Authentication → URL Configuration**, permita `https://tuliodubiella-arch.github.io/fechamento/` como redirect URL. Mantenha também `https://tuliodubiella-arch.github.io/painel-rotinas-grupo-cavalca/fechamento/` durante a transição. Em **Sign In / Providers**, desative cadastros públicos; novos usuários entram por convite. Configure o GitHub Pages com origem **GitHub Actions**; o fluxo em `.github/workflows/pages.yml` publica a branch `main`.
6. Teste convite, primeiro acesso, PLAY/PAUSE/STOP, sincronização em dois usuários, modo offline e fechamento completo antes de substituir o site atual.

Para a versão `2026.09.25`, aplique também `supabase/migrations/20260925_admin_corrections_versions.sql` no mesmo projeto antes de publicar os arquivos atualizados do site. A migração adiciona a correção administrativa auditável e o diário de versões; não altera os apontamentos já existentes.

Para a versão `2026.09.28.1`, aplique `supabase/migrations/20260928_task_retirement_admin.sql` antes de publicar a interface. Ela permite retirar uma tarefa a partir da competência selecionada sem apagar meses anteriores e concede perfil de administrador somente mediante ação de outro administrador. A retirada é recusada se a tarefa tiver apontamentos ativos no mês ou depois dele; use a correção administrativa primeiro. Peça aos usuários que sincronizem registros offline antes da retirada.

Para a versão `2026.09.28.2`, aplique `supabase/migrations/20260928_admin_time_edits.sql` antes de publicar a interface. A edição administrativa do tempo total exige que a tarefa esteja pausada ou finalizada, conexão, motivo e confirmação. Cada ajuste fica no histórico de correções com o valor anterior e o novo valor; os eventos PLAY/PAUSE/STOP originais são preservados.

Para a versão `2026.10.01.2`, aplique `supabase/migrations/20261001_receipt_evidence_organogram_admin.sql`. A migração mantém os recebimentos anteriores, cria o histórico de entregas parciais/completas e um bucket privado para prints, além de restringir toda a leitura do organograma aos administradores. O texto reconhecido por OCR não é enviado nem salvo; cada usuário confirma a data e hora sugeridas antes de registrar.

## Endereço e convites personalizados

- O endereço curto usa um repositório GitHub Pages próprio chamado `fechamento`, sem DNS da empresa. O endereço anterior permanece disponível durante a transição. As duas versões compartilham o mesmo banco; evite registrar a mesma atividade nas duas abas ao mesmo tempo quando estiver offline.
- Após publicar o novo repositório e validar HTTPS, publique a função `fc-invite-member` com o redirecionamento novo e configure **Site URL** e **Redirect URLs** em **Authentication → URL Configuration** no Supabase. Mantenha a URL antiga na lista de redirecionamento durante a transição. Teste login e convite antes de divulgar o endereço novo.
- O projeto Supabase Free criado após junho de 2026 exige SMTP próprio para editar os modelos de e-mail. Use um serviço de envio autorizado pela empresa e configure-o em **Authentication → Emails → SMTP Settings**, com remetente no domínio verificado. Depois, em **Templates → Invite user**, use o assunto `Convite para o Portal de Fechamento Contábil | Grupo Cavalca` e o conteúdo de `supabase/templates/invite-user.html`. Não salve senhas SMTP ou chaves de API no repositório.

Na migração inicial, os apontamentos de teste de setembro/2026 foram omitidos e os apontamentos reais de outubro/2026 preservados.

## Operação

- A conta de cada responsável usa e-mail e senha próprios. A pessoa convidada define a senha pelo link recebido. Se já usa o mesmo Supabase, entra com a senha existente.
- Em **Cadastros**, o administrador pode reenviar o convite apenas enquanto ele estiver pendente. O reenvio usa a conta existente e cria um novo link; quem já confirmou o e-mail deve usar **Esqueci minha senha** se não conseguir entrar.
- A primeira entrada em cada aparelho precisa de internet. Depois disso, a interface e os dados já carregados funcionam offline; alterações ficam em fila até a conexão voltar. Não limpe os dados do navegador enquanto houver registros pendentes.
- Os horários de execução e recebimento são mostrados em Brasília/DF. O servidor mantém os instantes em UTC.
- Em **Execução**, somente o administrador vê **Corrigir registros** nas rotinas com apontamentos. A ação exige conexão, motivo e confirmação; retira todos os eventos daquela rotina no mês selecionado dos tempos e indicadores, sem apagar a trilha de auditoria. Dispositivos com registros offline pendentes devem sincronizar antes de uma correção.
- Em **Versões**, somente o administrador consulta a trilha de correções e registra manutenções e atualizações do portal.
- Em **Execução**, o administrador pode excluir uma tarefa do mês selecionado e dos seguintes, com motivo, mantendo os fechamentos anteriores. Em **Cadastros**, pode promover um responsável ativo a administrador; o novo perfil acessa todas as telas.
- Em **Execução**, o administrador pode usar **Editar tempo** para corrigir a duração total de uma tarefa pausada ou finalizada. A tela **Versões** mostra quem fez o ajuste, quando, o motivo e os tempos anterior e novo.
- Em **Metas**, **Imprimir lista / PDF** gera uma lista compacta de cinco colunas (ordem, empresa, prioridade, dia útil e previsão) em A4 vertical; a exportação XLSX continua com as informações completas.
- Em **Metas**, cada setor pode registrar várias entregas por empresa e competência. Um print PNG/JPG/WebP de até 5 MB é obrigatório para cada novo recebimento; a leitura da imagem sugere horários, mas o usuário deve escolher e confirmar o horário do e-mail em Brasília. **Parcial** mantém o setor aberto; **Completa** o encerra. Os prints ficam privados no Supabase e podem conter informações do e-mail, portanto recorte dados desnecessários antes do envio. Se o aparelho estiver offline, o print aguarda sincronização local no mesmo navegador; não limpe seus dados antes da confirmação do envio.
- O organograma completo, inclusive a visualização por usuário, exige perfil de administrador. A interface e a política de leitura do banco aplicam essa restrição.
- Os dias úteis excluem sábados, domingos, feriados nacionais, 14/11 em Cascavel/PR, Corpus Christi de 2026 e feriados adicionais cadastrados no painel. Confirme feriados locais de anos futuros no cadastro.

