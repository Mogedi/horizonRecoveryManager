export class AIError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIError'
  }
}
