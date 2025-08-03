import * as path from 'path';
import { CallExpression, Identifier, ModuleKind, Node, Project, PropertyAccessExpression, ScriptTarget, SourceFile, SyntaxKind, Symbol as TsMorphSymbol, Type, TypeChecker } from 'ts-morph';
import * as ts from 'typescript';
import * as vscode from 'vscode';
import * as fs from 'fs';

const projectCache = new Map<string, Project>();

let isInserting: boolean = false;
let gotImport = false
export async function getProjectForDocument(document: vscode.TextDocument): Promise<Project> {
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
	const projectRoot = workspaceFolder
		? workspaceFolder.uri.fsPath
		: path.dirname(document.fileName);

	// 如果缓存中已有，直接返回
	if (projectCache.has(projectRoot)) {
		return projectCache.get(projectRoot)!;
	}

	// 查找 tsconfig.json
	const filesInRoot = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectRoot));
	let tsconfigPath = '';
	for (const [name, type] of filesInRoot) {
		if (name === 'tsconfig.json' && type === vscode.FileType.File) {
			tsconfigPath = path.join(projectRoot, name);
			break;
		}
	}

	let project: Project;
	if (tsconfigPath) {
		project = new Project({ tsConfigFilePath: tsconfigPath });
	} else {
		project = new Project({
			compilerOptions: {
				target: ScriptTarget.ESNext,
				module: ModuleKind.CommonJS,
				allowJs: true,
				checkJs: true,
				jsx: ts.JsxEmit.React,
				strict: true,
				esModuleInterop: true,
				forceConsistentCasingInFileNames: true,
				skipLibCheck: true,
			},
		});
	}

	projectCache.set(projectRoot, project); // 缓存起来
	return project;
}


export function activate(context: vscode.ExtensionContext) {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	if (!workspaceFolders) {
		return;
	}
	const rootPath = workspaceFolders[0].uri.fsPath;
	const packageJsonPath = path.join(rootPath, 'package.json');
	if (isFrontEnd(packageJsonPath)) {

		return
	}
	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {

		const document = event.document;

		if (document.languageId !== 'typescript' && document.languageId !== 'typescriptreact') {
			return;
		}

		if (isInserting) {
			return;
		}


		if (event.contentChanges.length === 1 && event.contentChanges[0].text.length > 1) {
			let name = event.contentChanges[0].text
			let offsetMoveLeft = 1
			if (name.startsWith('import ') || name.match(/^, [0-9a-z_]+$/i)) {
				gotImport = true
				return
			}
			if (name.includes('await')) {
				return
			}
			let isCompletedCall: boolean | { name: string, firstArgLength: number } = false
			if (!name.match(/^\.?[a-z]+[0-9a-z_]+$/i)) {
				isCompletedCall = matchFunctionCall(name) ?? false
				if (!isCompletedCall) {
					return
				}
				console.log(isCompletedCall)
				offsetMoveLeft = isCompletedCall.firstArgLength + 2
				name = isCompletedCall.name
			}
			let project = await getProjectForDocument(document)
			const editor = vscode.window.activeTextEditor;
			if (!editor || editor.document.uri.fsPath !== document.uri.fsPath) {
				return;
			}
			let sourceFile = project.getSourceFile(document.fileName);
			if (!sourceFile) {
				sourceFile = project.createSourceFile(document.fileName, document.getText(), { overwrite: true });
			}
			let tmpOffset = document.offsetAt(editor.selection.active) - offsetMoveLeft
			const tmpNode = sourceFile.getDescendantAtPos(tmpOffset);
			if (!tmpNode) {
				return
			}
			let tmpPosition = editor.selection.active;
			await new Promise(r => setTimeout(r, 50));

			if (gotImport) {
				// if got import, wait more
				await new Promise(r => setTimeout(r, 30));
			}

			let position = editor.selection.active;
			// if (gotImport || tmpPosition.line !== position.line) {
			// 	console.time('reload source')
			// 	sourceFile.replaceWithText(document.getText());
			// 	console.timeEnd('reload source')
			// }
			// console.time('reload source')
			sourceFile.replaceWithText(document.getText());
			// console.timeEnd('reload source')
			gotImport = false

			const offset = document.offsetAt(position);
			const nodeAtCursor = sourceFile.getDescendantAtPos(offset - offsetMoveLeft);
			if (!nodeAtCursor) {
				return
			}
			let fullName = getFullNodeName(nodeAtCursor)

			nodeAtCursor.getSymbol()

			let symbol = nodeAtCursor.getSymbol()
			if (!symbol) {

				return
			}


			let type: Type | undefined;
			try {
				type = symbol.getTypeAtLocation(nodeAtCursor);

			} catch (e) {
				console.error(`[onDidChangeTextDocument] Error getting type for symbol ${name}:`, e);
				return;
			}

			if (!type) {
				return;
			}

			const isPromise = isPromiseType(type);
			const isFunction = isFunctionType(type);

			if (!isPromise && !isFunction) {
				// do nothing
				return
			}
			isInserting = true;
			try {
				if (isPromise) {
					// insert await
					const insertPos = isCompletedCall ?
						new vscode.Position(position.line, position.character - fullName.length - isCompletedCall.firstArgLength - 1) :
						new vscode.Position(position.line, position.character - fullName.length);

					await editor.edit(editBuilder => {
						editBuilder.insert(insertPos, 'await ');
					});
					// insert async
					const isInAsyncContextResult = checkIfInAsyncContextAndGetInsertPosition(nodeAtCursor, document);
					if (!isInAsyncContextResult.isInAsyncContext) {

						if (isInAsyncContextResult.insertPosition) {

							await editor.edit(editBuilder => {
								editBuilder.insert(isInAsyncContextResult.insertPosition!, 'async ');
							});
						} else {

						}
					}
				}
				if (isFunction && !isCompletedCall) {

					const signatures = type.getCallSignatures();
					const signature = signatures[0];
					const parameters = signature.getParameters();
					if (isPromise) {
						const insertPos = new vscode.Position(position.line, position.character + 6);
						await editor.edit(editBuilder => {

							editBuilder.insert(insertPos, '()');
						});
						if (parameters.length) {
							const newPos = position.with(position.line, insertPos.character + 1);
							editor.selection = new vscode.Selection(newPos, newPos);
						}
					} else {

						await editor.edit(editBuilder => {
							editBuilder.insert(position, '()');
						});
						if (parameters.length) {
							const newPos = position.with(position.line, position.character + 1);
							editor.selection = new vscode.Selection(newPos, newPos);
						}
					}
					if (parameters.length) {
						await vscode.commands.executeCommand('editor.action.triggerParameterHints');

					}
				}
			} catch (e) {
				console.log('err', e)
			} finally {
				isInserting = false;
			}

		} else {

			return
		}

	}));
}

function checkIfInAsyncContextAndGetInsertPosition(
	nodeAtCursor: Node,
	document: vscode.TextDocument
): { isInAsyncContext: boolean; insertPosition?: vscode.Position } {

	const funcNode = nodeAtCursor.getAncestors().find(ancestor =>
		Node.isFunctionLikeDeclaration(ancestor)
	)

	if (funcNode) {
		const isAsync = funcNode.getModifiers().some(m => m.getKind() === SyntaxKind.AsyncKeyword);

		if (isAsync) {
			return { isInAsyncContext: true };
		} else {
			const insertOffset = funcNode.getStart();

			const insertPosition = document.positionAt(insertOffset);
			return { isInAsyncContext: false, insertPosition: insertPosition };
		}
	}

	return { isInAsyncContext: false };
}

function getFullNodeName(node: any) {
	while (
		node.getParent() &&
		(node.getParent().getKind() === SyntaxKind.PropertyAccessExpression ||
			node.getParent().getKind() === SyntaxKind.ElementAccessExpression)
	) {
		node = node.getParent();
	}

	return node.getText().trim();
}

function checkIfInAsyncContext(nodeAtCursor: Node, sourceFile: SourceFile): boolean {
	const funcNode = nodeAtCursor.getAncestors().find(ancestor =>
		Node.isFunctionLikeDeclaration(ancestor)
	);

	if (funcNode && Node.isFunctionLikeDeclaration(funcNode)) {
		const isAsync = funcNode.getModifiers().some(m => m.getKind() === SyntaxKind.AsyncKeyword);
		return isAsync;
	}
	return false;
}

function matchFunctionCall(str: string) {
	const regex = /^([a-zA-Z_]\w*)\s*\(\s*([^)]*)?\s*\)$/;
	const match = str.match(regex);
	if (!match) {
		return null;
	}

	const funcName = match[1];
	const args = match[2] ? match[2].split(/\s*,\s*/).filter(Boolean) : [];
	return { name: funcName, firstArgLength: args[0] ? args[0].length : 0 };
}

function isPromiseType(type: Type): boolean {
	if (!type) { return false }

	const symbol = type.getSymbol();

	if (symbol?.getName() === 'Promise') { return true }

	const typeText = type.getText();
	if (typeText.includes('Promise<') && typeText.endsWith('>')) {
		return true;
	}

	const typeArguments = type.getTypeArguments();
	if (typeArguments.length > 0) {
		if (typeText.startsWith('Promise<')) {
			return true;
		}
		for (const arg of typeArguments) {
			if (isPromiseType(arg)) {
				return true;
			}
		}
	}

	if (type.getCallSignatures().length > 0) {
		return type.getCallSignatures().some(signature => {
			const returnType = signature.getReturnType();
			return isPromiseType(returnType);
		});
	}

	if (type.isUnion()) {
		return type.getUnionTypes().some(t =>
			isPromiseType(t)
		);
	}

	const baseTypes = type.getBaseTypes() || [];
	for (const baseType of baseTypes) {
		if (isPromiseType(baseType)) {
			return true;
		}
	}

	return false;
}

function isFunctionType(type: Type): boolean {
	if (!type) { return false; }
	return type.getCallSignatures().length > 0;
}

function isFrontEnd(packageJsonPath: string) {
	if (fs.existsSync(packageJsonPath)) {
		try {
			const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
			const deps = Object.assign({}, pkg.dependencies, pkg.devDependencies);

			const hasReact =
				deps['react'] !== undefined || deps['react-dom'] !== undefined || deps['next'] !== undefined;

			if (hasReact) {

				return true
			}
		} catch (err) {
			console.error('[my-plugin] Failed to read package.json:', err);
		}
	}
}