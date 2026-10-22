-- Datas oficiais históricas são do tipo date: a planilha não fornece horário de encerramento.
-- A carga dos dados contábeis é feita diretamente no projeto privado, nunca neste repositório.
alter table public.fc_targets
  add column if not exists official_close_date date;

comment on column public.fc_targets.official_close_date is
  'Data oficial de encerramento de competências históricas, sem horário presumido.';
