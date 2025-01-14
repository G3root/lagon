use colored::Colorize;
use std::{
    collections::HashMap,
    fs,
    io::{self, Error, ErrorKind, Read},
    path::{Path, PathBuf},
    process::Command,
};

use multipart::{
    client::lazy::Multipart,
    server::nickel::nickel::hyper::{header::Headers, Client},
};
use serde::{Deserialize, Serialize};

use crate::utils::{get_api_url, print_progress, success};

#[derive(Serialize, Deserialize, Debug)]
pub struct DeploymentConfig {
    pub function_id: String,
    pub organization_id: String,
}

pub fn get_function_config() -> io::Result<Option<DeploymentConfig>> {
    let path = Path::new(".lagon/config.json");

    if !path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(path)?;
    let config = serde_json::from_str::<DeploymentConfig>(&content)?;

    Ok(Some(config))
}

pub fn write_function_config(config: DeploymentConfig) -> io::Result<()> {
    let path = Path::new(".lagon/config.json");

    if !path.exists() {
        fs::create_dir_all(".lagon")?;
    }

    let content = serde_json::to_string(&config)?;
    fs::write(path, content)
}

pub fn delete_function_config() -> io::Result<()> {
    let path = Path::new(".lagon/config.json");

    if !path.exists() {
        return Err(Error::new(
            ErrorKind::Other,
            "No configuration found in this directory.",
        ));
    }

    fs::remove_file(path)
}

fn esbuild(file: &PathBuf) -> io::Result<String> {
    let result = Command::new("esbuild")
        .arg(file)
        .arg("--bundle")
        .arg("--format=esm")
        .arg("--target=es2020")
        .arg("--platform=browser")
        .output()?;

    // TODO: check status code
    if result.status.success() {
        let output = result.stdout;

        return match String::from_utf8(output) {
            Ok(s) => Ok(s),
            Err(_) => Err(Error::new(
                ErrorKind::Other,
                "Failed to convert output to string",
            )),
        };
    }

    Err(Error::new(
        ErrorKind::Other,
        format!("Unexpected status code {}", result.status),
    ))
}

pub fn bundle_function(
    index: PathBuf,
    client: Option<PathBuf>,
    _public_dir: PathBuf,
) -> io::Result<(String, HashMap<String, String>)> {
    if let Err(_) = Command::new("esbuild").arg("--version").output() {
        return Err(Error::new(
            ErrorKind::Other,
            "esbuild is not installed. Please install it with `npm install -g esbuild`",
        ));
    }

    let end_progress = print_progress("Bundling Function handler...");
    let index_output = esbuild(&index)?;
    end_progress();

    let mut assets = HashMap::<String, String>::new();

    if let Some(client) = client {
        let end_progress = print_progress("Bundling client file...");
        let client_output = esbuild(&client)?;
        end_progress();

        assets.insert(
            client.file_name().unwrap().to_str().unwrap().to_string(),
            client_output,
        );
    }

    // TODO: assets

    Ok((index_output, assets))
}

#[derive(Deserialize, Debug)]
struct DeploymentResponse {
    functionName: String,
}

pub fn create_deployment(
    function_id: String,
    file: PathBuf,
    client: Option<PathBuf>,
    public_dir: PathBuf,
    token: String,
) -> io::Result<()> {
    let (index, assets) = bundle_function(file, client, public_dir)?;

    let end_progress = print_progress("Uploading files...");

    let mut multipart = Multipart::new();
    multipart.add_text("functionId", function_id);
    multipart.add_stream(
        "code",
        index.as_bytes(),
        Some("index.js"),
        Some(mime::TEXT_JAVASCRIPT),
    );

    for (path, content) in &assets {
        multipart.add_stream("assets", content.as_bytes(), Some(path), None);
    }

    let client = Client::new();
    let url = get_api_url() + "/deployment";

    let mut response = multipart
        .client_request_mut(&client, &url, |request| {
            let mut headers = Headers::new();
            headers.set_raw("x-lagon-token", vec![token.as_bytes().to_vec()]);
            request.headers(headers)
        })
        .unwrap();

    end_progress();

    let mut buf = String::new();
    response.read_to_string(&mut buf)?;

    let response = serde_json::from_str::<DeploymentResponse>(&buf)?;

    println!();
    println!("{}", success("Function deployed!"));
    println!();
    println!(
        " {} https://{}.lagon.app",
        "➤".black(),
        response.functionName.blue()
    );
    println!();

    Ok(())
}
