export class TreeforkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class TreeforkGitError extends TreeforkError {
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly command: readonly string[];

  constructor(options: {
    stderr: string;
    exitCode: number | null;
    command: readonly string[];
    message?: string;
    cause?: unknown;
  }) {
    const commandText = options.command.join(" ");
    const suffix = options.stderr ? `: ${options.stderr}` : "";

    super(options.message ?? `Git command failed (${commandText})${suffix}`, {
      cause: options.cause,
    });

    this.stderr = options.stderr;
    this.exitCode = options.exitCode;
    this.command = options.command;
  }
}

export class WorkspaceNotFoundError extends TreeforkError {}

export class WorkspaceExistsError extends TreeforkError {}

export class CheckpointNotFoundError extends TreeforkError {}

export class CheckpointExistsError extends TreeforkError {}

export class InvalidNameError extends TreeforkError {}
