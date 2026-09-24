export function errorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  if (!(error instanceof Error) || !error.message) return fallback;

  return error.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] || fallback;
}
