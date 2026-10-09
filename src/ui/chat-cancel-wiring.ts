/** Invoked by chat UI when user cancels an in-flight chat or mesh request. */
export function cancelInFlightChat(plugin: { cancelChatRequest?: () => void }): void {
  plugin.cancelChatRequest?.();
}

export function cancelInFlightMesh(plugin: { cancelMeshRequest?: () => void }): void {
  plugin.cancelMeshRequest?.();
}
