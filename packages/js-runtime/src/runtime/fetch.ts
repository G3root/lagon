import { RequestInit } from './Request';
import { Response } from './Response';

export class Headers {
  private headers: Map<string, string[]> = new Map();

  constructor(init?: Record<string, string> | string[][]) {
    if (init) {
      if (Array.isArray(init)) {
        init.forEach(([key, value]) => {
          this.addValue(key, value);
        });
      } else {
        Object.entries(init).forEach(([key, value]) => {
          this.addValue(key, value);
        });
      }
    }
  }

  private addValue(name: string, value: string) {
    const values = this.headers.get(name);

    if (values) {
      values.push(value);
    } else {
      this.headers.set(name, [value]);
    }
  }

  append(name: string, value: string) {
    this.addValue(name, value);
  }

  delete(name: string) {
    this.headers.delete(name);
  }

  *entries(): IterableIterator<[string, string]> {
    for (const [key, values] of this.headers) {
      for (const value of values) {
        yield [key, value];
      }
    }
  }

  get(name: string): string | undefined {
    return this.headers.get(name)?.[0];
  }

  has(name: string): boolean {
    return this.headers.has(name);
  }

  keys(): IterableIterator<string> {
    return this.headers.keys();
  }

  set(name: string, value: string) {
    this.headers.set(name, [value]);
  }

  *values(): IterableIterator<string> {
    for (const [, values] of this.headers) {
      for (const value of values) {
        yield value;
      }
    }
  }
}

export async function fetch(resource: string, init: RequestInit) {
  const response = await Lagon.fetch(resource, init);

  return new Response(response.body, {
    // url: response.options.url,
    // headers: response.options.headers,
    // status: response.options.status,
  });
}
