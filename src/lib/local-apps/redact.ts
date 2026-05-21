const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(--?(?:token|api[-_]?key|secret|password|passwd|pwd|auth|authorization)(?:=|\s+))(["']?)[^\s"']+/gi, "$1$2[redacted]"],
  [/((?:token|api[-_]?key|secret|password|passwd|pwd|auth|authorization)=)(["']?)[^\s"']+/gi, "$1$2[redacted]"],
  [/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]"],
  [/(Authorization:\s*)(["']?)[^"'\s]+/gi, "$1$2[redacted]"],
];

export function redactSensitiveArgs(args: string): string {
  return SECRET_PATTERNS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), args);
}

