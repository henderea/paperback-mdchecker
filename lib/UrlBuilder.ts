export class URLBuilder {
  private readonly parameters: Dictionary<any> = {};
  private readonly pathComponents: string[] = [];
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/(^\/)?(?=.*)(\/$)?/gim, '');
  }

  addPathComponent(component: string): this {
    this.pathComponents.push(component.replace(/(^\/)?(?=.*)(\/$)?/gim, ''));
    return this;
  }

  addQueryParameter(key: string, value: any): this {
    this.parameters[key] = value;
    return this;
  }

  buildUrl({ addTrailingSlash, includeUndefinedParameters } = { addTrailingSlash: false, includeUndefinedParameters: false }): string {
    let finalUrl: string = this.baseUrl + '/';

    finalUrl += this.pathComponents.join('/');
    finalUrl += addTrailingSlash ? '/' : '';
    finalUrl += Object.values(this.parameters).length > 0 ? '?' : '';
    finalUrl += Object.entries(this.parameters).map((entry) => {
      if(!entry[1] && !includeUndefinedParameters) { return undefined; }

      if(Array.isArray(entry[1])) {
        return entry[1].map((value) => value || includeUndefinedParameters ? `${entry[0]}[]=${value}` : undefined)
          .filter((x) => x !== undefined)
          .join('&');
      }

      if(typeof entry[1] === 'object') {
        return Object.keys(entry[1]).map((key) => entry[1][key] || includeUndefinedParameters ? `${entry[0]}[${key}]=${entry[1][key]}` : undefined)
          .filter((x) => x !== undefined)
          .join('&');
      }

      return `${entry[0]}=${entry[1]}`;
    }).filter((x) => x !== undefined).join('&');

    return finalUrl;
  }
}
