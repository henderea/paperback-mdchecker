import type { Response } from 'got';
import got from 'got';

declare interface StandardResponse {
  status: number;
}

export declare type ApiResult = boolean | 'api-unavailable';

export declare type MessagePriority = -2 | -1 | 0 | 1 | 2;

class Message {
  private readonly _apiToken: string;
  private readonly _userToken: string;
  private readonly _message: string;
  private _messagePriority: MessagePriority | undefined;
  private _messageHtml: boolean = false;
  private _messageMonospace: boolean = false;
  private _messageTimestamp: number | undefined;
  private _messageTitle: string | undefined;
  private _messageTtl: number | undefined;
  private _messageUrl: string | undefined;
  private _messageUrlTitle: string | undefined;

  constructor(apiToken: string, userToken: string, message: string) {
    this._apiToken = apiToken;
    this._userToken = userToken;
    this._message = message;
  }

  private get apiToken(): string { return this._apiToken; }
  private get userToken(): string { return this._userToken; }
  get message(): string { return this._message; }
  get messagePriority(): MessagePriority | undefined { return this._messagePriority; }
  get messageHtml(): boolean { return this._messageHtml; }
  get messageMonospace(): boolean { return this._messageMonospace; }
  get messageTimestamp(): number | undefined { return this._messageTimestamp; }
  get messageTitle(): string | undefined { return this._messageTitle; }
  get messageTtl(): number | undefined { return this._messageTtl; }
  get messageUrl(): string | undefined { return this._messageUrl; }
  get messageUrlTitle(): string | undefined { return this._messageUrlTitle; }

  priority(value: MessagePriority | undefined): this {
    this._messagePriority = value;
    return this;
  }
  html(value: boolean = true): this {
    this._messageHtml = value;
    if(value) {
      this._messageMonospace = false;
    }
    return this;
  }
  monospace(value: boolean = true): this {
    this._messageMonospace = value;
    if(value) {
      this._messageHtml = false;
    }
    return this;
  }
  timestamp(value: Date | number | undefined): this {
    if(typeof value == 'number' || !value) {
      this._messageTimestamp = value;
    } else {
      this._messageTimestamp = value.getTime();
    }
    return this;
  }
  title(value: string | undefined): this {
    this._messageTitle = value;
    return this;
  }
  ttlSeconds(value: number | undefined): this {
    this._messageTtl = value;
    return this;
  }
  url(value: string | undefined, title: string | undefined = undefined): this {
    this._messageUrl = value;
    this._messageUrlTitle = title;
    return this;
  }
  urlTitle(value: string | undefined): this {
    this._messageUrlTitle = value;
    return this;
  }

  async send(options: Dictionary<any> = {}): Promise<ApiResult> {
    const form: Dictionary<any> = { ...options };
    form.token = this.apiToken;
    form. user = this.userToken;
    form.message = this.message;
    if(this.messagePriority || this.messagePriority === 0) { form.priority = this.messagePriority; }
    if(this.messageHtml) { form.html = 1; }
    if(this.messageMonospace) { form.monospace = 1; }
    if(this.messageTimestamp) { form.timestamp = this.messageTimestamp; }
    if(this.messageTitle) { form.title = this.messageTitle; }
    if(this.messageTtl) { form.ttl = this.messageTtl; }
    if(this.messageUrl) { form.url = this.messageUrl; }
    if(this.messageUrl && this.messageUrlTitle) { form.url_title = this.messageUrlTitle; }

    const response: Response<StandardResponse> = await got.post('https://api.pushover.net/1/messages.json', {
      form,
      responseType: 'json'
    });
    const statusCode: number = response.statusCode;
    if(statusCode == 200) {
      const result: StandardResponse = response.body;
      return result?.status == 1;
    }
    if(statusCode >= 400 && statusCode < 500) {
      throw new Error(`There is an issue with the request. Status code ${statusCode}; body: ${response.body}`);
    }
    return 'api-unavailable';
  }
}

export class Pushover {
  private readonly _apiToken: string;
  private readonly _userToken: string;

  constructor(apiToken: string, userToken: string) {
    this._apiToken = apiToken;
    this._userToken = userToken;
  }

  get apiToken(): string { return this._apiToken; }
  get userToken(): string { return this._userToken; }

  async checkUser(): Promise<ApiResult> {
    const token: string = this.apiToken;
    const user: string = this.userToken;
    const response: Response<StandardResponse> = await got.post('https://api.pushover.net/1/users/validate.json', {
      form: {
        token,
        user
      },
      responseType: 'json'
    });
    const statusCode: number = response.statusCode;
    if(statusCode == 200) {
      const result: StandardResponse = response.body;
      return result?.status == 1;
    }
    if(statusCode >= 400 && statusCode < 500) {
      throw new Error(`There is an issue with the request. Status code ${statusCode}; body: ${response.body}`);
    }
    return 'api-unavailable';
  }

  message(message: string): Message {
    return new Message(this.apiToken, this.userToken, message);
  }
}
