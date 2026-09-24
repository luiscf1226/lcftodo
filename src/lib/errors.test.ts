import { expect, test } from "vitest";
import { errorMessage } from "./errors";

const serverError = (message: string) =>
  new Error(`[CONVEX M(x)] [Request ID: 1] Server Error Uncaught Error: ${message}`);

test("translates server limit errors to Spanish", () => {
  expect(errorMessage(serverError("Date range is too long: export at most 366 days at a time."))).toBe(
    "El período es demasiado largo. Exporta como máximo 366 días a la vez.",
  );
  expect(errorMessage(serverError("Pick at most 90 days."))).toBe("Elige como máximo 90 días.");
  expect(errorMessage(serverError("Pick at most 50 projects."))).toBe("Elige como máximo 50 proyectos.");
});
