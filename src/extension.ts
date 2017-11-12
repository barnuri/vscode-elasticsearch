'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as request from 'request';
import url = require('url');
import path = require('path');
import * as fs from 'fs';


import { ElasticCodeLensProvider } from './ElasticCodeLensProvider'
import { ElasticContentProvider } from './ElasticContentProvider'
import { ElasticDecoration } from './ElasticDecoration'
import { ElasticMatch } from './ElasticMatch'

// import { JSONCompletionItemProvider } from "./JSONCompletionItemProvider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

    // vscode.workspace.getConfiguration(section)

    const languages = ['es'];

    context.subscriptions.push(vscode.languages.registerCodeLensProvider(languages, new ElasticCodeLensProvider(context)));



    // let provider = new JSONCompletionItemProvider();
    // provider.init().then((result) => {
    //     if (!result.success) {
    //         console.log(`CompletionItemProvider init failed: ${(result.error.message)}`);
    //         vscode.window.showErrorMessage('Something went wrong. Please see the console!');
    //     }

    //     else {
    //         console.log(`CompletionItemProvider successfully loaded ${provider.count} items from '${provider.filepath}'.`);
    //         vscode.window.showInformationMessage('Ready!');
    //         context.subscriptions.push(vscode.languages.registerCompletionItemProvider(languages, provider));
    //     }
    // });

    let resultsProvider = new ElasticContentProvider();
    const registration = vscode.workspace.registerTextDocumentContentProvider("elastic", resultsProvider);
    const previewUri = "elastic://results";

    // vscode.languages.registerCompletionItemProvider('es', {
    //     provideCompletionItems(document, position, token) {
    //         // return [new vscode.CompletionItem('Hello World')];
    //         var g = document.lineAt(position.line).text[position.character - 1];
    //         return null;
    //     }
    // });



    context.subscriptions.push(vscode.commands.registerCommand('elastic.execute', (em: ElasticMatch) => {
        executeQuery(context, resultsProvider, em);
    }));


    let decoration = new ElasticDecoration(context)

    vscode.workspace.onDidChangeTextDocument((e) => {
        var editor = vscode.window.activeTextEditor
        if (e.document === editor.document) {
            decoration.UpdateDecoration(editor)
        }
    });

    vscode.workspace.onDidChangeConfiguration((e) => {
        //vscode.window.showInformationMessage('Ready!');
    });

    //vscode.window.onDidChangeTextEditorSelection((e) => {
    //    if (e.textEditor === vscode.window.activeTextEditor) {
            // decoration.bHighlight
            // decoration.UpdateDecoration(e.textEditor)
    //    }
    //});

    context.subscriptions.push(vscode.commands.registerCommand('elastic.setHost', () => {
        setHost(context);
    }));

    vscode.commands.registerCommand('extension.setClip', (uri, query) => {
        var ncp = require("copy-paste");
        ncp.copy(query, function () {
            vscode.window.showInformationMessage("Copied to clipboard");
        });
    });

    context.subscriptions.push(vscode.commands.registerCommand('elastic.open', (em: ElasticMatch) => {
        var column = 0
        let uri = vscode.Uri.file(em.File.Text)
        return vscode.workspace.openTextDocument(uri)
            .then(textDocument => vscode.window.showTextDocument(textDocument, column ? column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column : undefined, true))

    }));

    context.subscriptions.push(vscode.commands.registerCommand('elastic.lint', (em: ElasticMatch) => {

        try {
            let l = em.Method.Range.start.line + 1
            const editor = vscode.window.activeTextEditor

            editor.edit(editBuilder => {
                if (em.HasBody) {
                    let txt = editor.document.getText(em.Body.Range)
                    editBuilder.replace(em.Body.Range, JSON.stringify(JSON.parse(em.Body.Text), null, 4))
                }
            });
        } catch (error) {
            console.log(error.message)
        }
    }));

}

async function setHost(context: vscode.ExtensionContext): Promise<string> {
    let options: vscode.InputBoxOptions;

    const host = await vscode.window.showInputBox(<vscode.InputBoxOptions>{
        prompt: "Please enter the elastic host",
        ignoreFocusOut: true,
        value: context.workspaceState.get("elastic.host", "localhost:9200")
    });

    context.workspaceState.update("elastic.host", host);
    return new Promise<string>((resolve) => resolve(host));
}

export async function executeQuery(context: vscode.ExtensionContext, resultsProvider: ElasticContentProvider, em: ElasticMatch) {
    const host: string = context.workspaceState.get("elastic.host", null) || await setHost(context);

    const requestUrl: string = url.format({
        host,
        pathname: em.Path.Text,
        protocol: 'http'
    });

    const startTime = new Date().getTime();

    const config = vscode.workspace.getConfiguration();
    var asDocument = config.get("elastic.showResultAsDocument")
    if (!asDocument) {
        vscode.commands.executeCommand("vscode.previewHtml", resultsProvider.contentUri, vscode.ViewColumn.Two, 'ElasticSearch Query');
        resultsProvider.update(context, host, '', startTime, 0, 'Executing query ...')
    }

    const sbi = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    sbi.text = "$(search) Executing query ...";
    sbi.show();



    request(<request.UrlOptions & request.CoreOptions>{
        url: requestUrl,
        method: em.Method.Text,
        body: em.Body.Text,
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        }
    }, (error, response, body) => {

        sbi.dispose();
        const endTime = new Date().getTime();


        if (error) {
            if (asDocument) {
                vscode.window.showErrorMessage(error.message);
            }
            else {
                resultsProvider.update(context, host, null, endTime - startTime, -1, error.message);
                vscode.commands.executeCommand("vscode.previewHtml", resultsProvider.contentUri, vscode.ViewColumn.Two, 'ElasticSearch Results');
            }
        }
        else {

            let results = body;
            if (asDocument) {
                results = JSON.stringify(JSON.parse(results), null, 4)
                showResult(results, vscode.window.activeTextEditor.viewColumn + 1)
            }
            else {
                resultsProvider.update(context, host, results, endTime - startTime, response.statusCode, response.statusMessage);
                vscode.commands.executeCommand("vscode.previewHtml", resultsProvider.contentUri, vscode.ViewColumn.Two, 'ElasticSearch Results');
            }
        }
    })
}


function showResult(result: string, column?: vscode.ViewColumn): Thenable<void> {
    let uri = vscode.Uri.file(path.join(vscode.workspace.rootPath, 'result.json'));
    if (!fs.existsSync(uri.fsPath)) {
        uri = uri.with({ scheme: 'untitled' });
    }
    return vscode.workspace.openTextDocument(uri)
        .then(textDocument => vscode.window.showTextDocument(textDocument, column ? column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column : undefined, true))
        .then(editor => {
            editor.edit(editorBuilder => {
                if (editor.document.lineCount > 0) {
                    const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
                    editorBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine.range.start.line, lastLine.range.end.character)));
                }
                editorBuilder.insert(new vscode.Position(0, 0), result);
            });
        });
}



// this method is called when your extension is deactivated
export function deactivate() {
}