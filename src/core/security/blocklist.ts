export function isBlockedCommand(command: string, blockedCommands: string[]): boolean {
  const normalizedCommand = command.trim().toLowerCase();
  return blockedCommands.some(blocked => {
    const normalizedBlocked = blocked.trim().toLowerCase();
    return normalizedCommand.includes(normalizedBlocked);
  });
}
