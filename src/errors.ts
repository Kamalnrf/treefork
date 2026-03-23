export class BractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class BractGitError extends BractError {
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

export class WorkspaceNotFoundError extends BractError {}

export class WorkspaceExistsError extends BractError {}

export class CheckpointNotFoundError extends BractError {}

export class CheckpointExistsError extends BractError {}

export class InvalidNameError extends BractError {}
