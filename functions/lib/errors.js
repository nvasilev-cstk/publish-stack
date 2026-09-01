// Pulls every useful field off an error into a plain object so it survives
// JSON.stringify intact — @contentstack/management errors often carry the
// real detail in .errorMessage/.errorCode/.status rather than .message, and
// a bare `String(err)` or `err.message` alone can hide all of that.
export function describeError(err, phase) {
  if (!err) return { message: 'Unknown error (no error object)', phase };
  const details = {
    message: err.message || String(err),
    phase: err.phase || phase,
  };
  if (err.name) details.name = err.name;
  if (err.stack) details.stack = err.stack;
  if (err.status !== undefined) details.status = err.status;
  if (err.statusText) details.statusText = err.statusText;
  if (err.errorCode !== undefined) details.errorCode = err.errorCode;
  if (err.errorMessage) details.errorMessage = err.errorMessage;
  if (err.errors) details.errors = err.errors;
  if (err.context) details.context = err.context;
  return details;
}
