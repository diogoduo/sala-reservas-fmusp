import { describe, expect, it } from "vitest";
import * as frontendCalendar from "../../../frontend/src/lib/calendar";
import { addDays, cancellationDeadline, holidayName, isBusinessDay } from "../../src/lib/calendar";

describe("feriados", () => {
  it("fixos: nacionais, estadual e municipais", () => {
    expect(holidayName("2026-11-20")).toBe("Dia da Consciência Negra");
    expect(holidayName("2026-07-09")).toBe("Revolução Constitucionalista");
    expect(holidayName("2027-01-25")).toBe("Aniversário de São Paulo");
    expect(holidayName("2026-11-19")).toBeNull();
  });

  it("móveis, a partir da Páscoa", () => {
    // Páscoa de 2026: 5/4; de 2027: 28/3.
    expect(holidayName("2026-02-16")).toBe("Carnaval (ponto facultativo)");
    expect(holidayName("2026-02-17")).toBe("Carnaval (ponto facultativo)");
    expect(holidayName("2026-04-03")).toBe("Sexta-feira Santa");
    expect(holidayName("2026-06-04")).toBe("Corpus Christi");
    expect(holidayName("2027-02-08")).toBe("Carnaval (ponto facultativo)");
    expect(holidayName("2027-03-26")).toBe("Sexta-feira Santa");
    expect(holidayName("2027-05-27")).toBe("Corpus Christi");
  });

  it("dia útil: segunda a sexta, fora de feriado", () => {
    expect(isBusinessDay("2026-11-19")).toBe(true); // quinta
    expect(isBusinessDay("2026-11-20")).toBe(false); // feriado
    expect(isBusinessDay("2026-11-21")).toBe(false); // sábado
    expect(isBusinessDay("2026-11-22")).toBe(false); // domingo
  });

  it("a lista do front-end é igual à do back-end (2025 a 2035)", () => {
    for (let key = "2025-01-01"; key < "2036-01-01"; key = addDays(key, 1)) {
      expect(frontendCalendar.holidayName(key), key).toBe(holidayName(key));
    }
  });
});

describe("prazo de 3 dias úteis (Portaria 2793, Art. 9º)", () => {
  it("atividade na quinta: até a segunda", () => {
    expect(cancellationDeadline("2026-11-12")).toBe("2026-11-09");
  });

  it("atividade na segunda: até a quarta anterior", () => {
    expect(cancellationDeadline("2026-11-16")).toBe("2026-11-11");
  });

  it("feriado no meio não conta", () => {
    // Segunda 23/11: sexta 20/11 é feriado, então contam qui 19, qua 18 e ter 17.
    expect(cancellationDeadline("2026-11-23")).toBe("2026-11-17");
  });

  it("atividade no sábado: até a quarta", () => {
    expect(cancellationDeadline("2026-11-14")).toBe("2026-11-11");
  });

  it("front-end e back-end calculam o mesmo prazo", () => {
    for (let key = "2026-01-01"; key < "2028-01-01"; key = addDays(key, 1)) {
      expect(frontendCalendar.cancellationDeadline(key), key).toBe(cancellationDeadline(key));
    }
  });
});
