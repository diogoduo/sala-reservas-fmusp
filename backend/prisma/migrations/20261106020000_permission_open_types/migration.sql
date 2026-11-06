-- Fase 9: Cultura e Extensão e Concurso passam a ter permissão própria, para o
-- SAD poder tirá-los de quem só pede um tipo (ex.: o Serviço de Pós-Graduação).
-- Os valores novos só podem ser usados depois deste commit: o padrão e a
-- carga ficam na migration seguinte.
ALTER TYPE "permission" ADD VALUE 'REQUEST_CULTURE_EXTENSION';
ALTER TYPE "permission" ADD VALUE 'REQUEST_PUBLIC_EXAM';
