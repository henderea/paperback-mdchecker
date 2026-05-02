import { nullIfEmpty, _ } from './utils';

function processParams(parameters: Dictionary<any>, includeUndefinedParameters: boolean): string[] {
  return _.compact(Object.entries(parameters).flatMap((entry) => {
    if(!entry[1] && !includeUndefinedParameters) { return []; }

    if(Array.isArray(entry[1])) {
      return _.map(entry[1], (value) => value || includeUndefinedParameters ? `${entry[0]}[]=${value}` : undefined);
    }

    if(typeof entry[1] === 'object') {
      return _.map(Object.keys(entry[1]), (key) => entry[1][key] || includeUndefinedParameters ? `${entry[0]}[${key}]=${entry[1][key]}` : undefined);
    }

    return [`${entry[0]}=${entry[1]}`];
  }));
}

export class PreCompiledUrl {
  private readonly _url: string;
  private readonly _builtParams: string | null;
  private readonly _includeUndefinedParameters: boolean;

  constructor(url: string, builtParams: string | null, includeUndefinedParameters: boolean) {
    this._url = url;
    this._builtParams = nullIfEmpty(builtParams);
    this._includeUndefinedParameters = includeUndefinedParameters;
  }

  private get url(): string { return this._url; }
  private get builtParams(): string | null { return this._builtParams; }
  private get includeUndefinedParameters(): boolean { return this._includeUndefinedParameters; }

  buildUrl(extraParams: Dictionary<any>): string {
    const processedExtraParams: string = processParams(extraParams, this.includeUndefinedParameters).join('&');
    const builtParams: string = _.compact([this.builtParams, processedExtraParams]).join('&');
    return this.url + (builtParams == '' ? '' : `?${builtParams}`);
  }
}

export class URLBuilder {
  private readonly _parameters: Dictionary<any> = {};
  private readonly _pathComponents: string[] = [];
  private readonly _baseUrl: string;

  constructor(baseUrl: string) {
    this._baseUrl = baseUrl.replace(/(^\/)?(?=.*)(\/$)?/gim, '');
  }

  private get parameters(): Dictionary<any> { return this._parameters; }
  private get pathComponents(): string[] { return this._pathComponents; }
  private get baseUrl(): string { return this._baseUrl; }

  addPathComponent(component: string): this {
    this.pathComponents.push(component.replace(/(^\/)?(?=.*)(\/$)?/gim, ''));
    return this;
  }

  addQueryParameter(key: string, value: any): this {
    this.parameters[key] = value;
    return this;
  }

  buildUrl({ addTrailingSlash, includeUndefinedParameters } = { addTrailingSlash: false, includeUndefinedParameters: false }): string {
    const finalUrl: string = [this.baseUrl, ...this.pathComponents].join('/') + (addTrailingSlash ? '/' : '');
    const builtParams: string = processParams(this.parameters, includeUndefinedParameters).join('&');
    return finalUrl + (builtParams == '' ? '' : `?${builtParams}`);
  }

  preCompile({ addTrailingSlash, includeUndefinedParameters } = { addTrailingSlash: false, includeUndefinedParameters: false }): PreCompiledUrl {
    const finalUrl: string = [this.baseUrl, ...this.pathComponents].join('/') + (addTrailingSlash ? '/' : '');
    const builtParams: string = processParams(this.parameters, includeUndefinedParameters).join('&');

    return new PreCompiledUrl(finalUrl, builtParams, includeUndefinedParameters);
  }
}
