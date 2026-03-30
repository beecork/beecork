export interface NotificationProvider {
  readonly id: string;
  readonly name: string;
  send(message: string, urgent?: boolean): Promise<void>;
}
