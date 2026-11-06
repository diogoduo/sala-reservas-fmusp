-- Fase 9, bloco 3: áreas de apoio (átrios, halls, terraço, copas) no cadastro
-- de espaços. O valor novo só pode ser usado depois deste commit: o CHECK que
-- depende dele fica na migration seguinte.
ALTER TYPE "room_type" ADD VALUE 'SUPPORT_AREA';
