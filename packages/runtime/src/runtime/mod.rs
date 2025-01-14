use v8::V8;

use crate::isolate::IsolateOptions;

static JS_RUNTIME: &str = include_str!("../../runtime.js");

pub struct RuntimeOptions {
    allow_eval: bool,
}

impl Default for RuntimeOptions {
    fn default() -> Self {
        Self { allow_eval: false }
    }
}

pub struct Runtime;

unsafe impl Send for Runtime {}
unsafe impl Sync for Runtime {}

impl Runtime {
    pub fn new(options: RuntimeOptions) -> Self {
        let platform = v8::new_default_platform(0, false).make_shared();
        V8::initialize_platform(platform);
        V8::initialize();

        // Disable code generation from `eval(...)` / `new Function(...)`
        if !options.allow_eval {
            V8::set_flags_from_string("--disallow-code-generation-from-strings");
        }

        Runtime {}
    }

    pub fn dispose(&self) {
        unsafe {
            V8::dispose();
        }

        V8::dispose_platform();
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        self.dispose();
    }
}

pub fn get_runtime_code<'a>(
    scope: &mut v8::HandleScope<'a, ()>,
    options: &IsolateOptions,
) -> Option<v8::Local<'a, v8::String>> {
    let IsolateOptions {
        code,
        environment_variables,
        ..
    } = options;

    let environment_variables = match environment_variables {
        Some(environment_variables) => environment_variables
            .iter()
            .map(|(k, v)| format!("globalThis.process.env.{} = '{}'", k, v))
            .collect::<Vec<String>>()
            .join("\n"),
        None => "".to_string(),
    };

    v8::String::new(
        scope,
        &format!(
            r#"
{JS_RUNTIME}

(() => {{
    {environment_variables}
}})()

{code}

export async function masterHandler(request) {{
    const handlerRequest = new Request(request.input, {{
      method: request.method,
      headers: request.headers,
      body: request.body,
    }});

    return handler(handlerRequest);
  }}
"#
        ),
    )
}
