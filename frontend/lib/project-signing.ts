export function buildProjectRegistrationMessage(projectPubkey: string): string {
  return `hackbet:register:${projectPubkey}`;
}
