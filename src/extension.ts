import * as path from 'path';
import { CallExpression, Identifier, ModuleKind, Node, Project, PropertyAccessExpression, ScriptTarget, SourceFile, SyntaxKind, Symbol as TsMorphSymbol, Type, TypeChecker } from 'ts-morph';
import * as ts from 'typescript';
import * as vscode from 'vscode';

let projectInstance: Project | undefined;
let isInsertingAwait: boolean = false;
const invalidVarCharsRegex = /[^a-zA-Z0-9_$]/;


export function activate(context: vscode.ExtensionContext) {

	const workspaceFolders = vscode.workspace.workspaceFolders;
	// if (workspaceFolders && workspaceFolders.length > 0) {
	//     projectInstance = new Project({ });
	// }

	context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
		console.log('event.contentChanges:', event.contentChanges)
		const document = event.document;


		if (document.languageId !== 'typescript' && document.languageId !== 'typescriptreact') {
			return;
		}

		if (!projectInstance) {

			return;
		}

		if (isInsertingAwait) {

			return;
		}

		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.fsPath !== document.uri.fsPath) {

			return;
		}
		let sourceFile = projectInstance.getSourceFile(document.fileName);
		if (!sourceFile) {
			return
		}
		let addedImportedSymbolName
		if (event.contentChanges.length === 1 && event.contentChanges[0].text.length > 1) {
			console.log('debug event.contentChanges[0].text', event.contentChanges[0].text)
			addedImportedSymbolName = isFunctionCallFormat(event.contentChanges[0].text)
			if (!addedImportedSymbolName) {

				if (event.contentChanges[0].text.match(/^await /)) {

					let pos = editor.selection.active;
					console.log('debug document.offsetAt(pos)', document.offsetAt(pos))
					const nodeAtCursor = sourceFile.getDescendantAtPos(document.offsetAt(pos) + 6 - event.contentChanges[0].text.length);
					if (!nodeAtCursor) {

						return
					}
					const isInAsyncContextResult = checkIfInAsyncContextAndGetInsertPosition(nodeAtCursor, document);
					if (!isInAsyncContextResult.isInAsyncContext) {

						const editor = vscode.window.activeTextEditor;
						if (!editor) {

							return
						}
						if (isInAsyncContextResult.insertPosition) {

							await editor.edit(editBuilder => {
								editBuilder.insert(isInAsyncContextResult.insertPosition!, 'async ');
							});
						} else {

						}
					}
				}
				return
			}
			console.log('got addedImportedSymbolName', addedImportedSymbolName)
		} else {

			return
		}

		if (!addedImportedSymbolName) {

			return;
		}

		await new Promise(resolve => setTimeout(resolve, 80));
		const position = editor.selection.active; // cursor position

		if (!sourceFile) {

			sourceFile = projectInstance.createSourceFile(document.fileName, document.getText(), { overwrite: true });
		} else {
			sourceFile.replaceWithText(document.getText());
		}

		const offset = document.offsetAt(position);
		const nodeAtCursor = sourceFile.getDescendantAtPos(offset);

		if (!nodeAtCursor) {

			return;
		}

		const typeChecker = projectInstance.getTypeChecker();

		const lineText = document.lineAt(position.line).text;
		let symbolNameToCheck = addedImportedSymbolName;
		// let symbolPosition: vscode.Position | undefined;
		let symbolRes = getSymbolBeforeCursor(document, position, projectInstance, sourceFile)

		if (!symbolRes) {

			return
		}

		let { symbol, symbolPosition } = symbolRes
		console.log('debug got symbol: ', symbol.getName())

		let type: Type | undefined;
		try {
			type = symbol.getTypeAtLocation(nodeAtCursor);

		} catch (e) {
			console.error(`[onDidChangeTextDocument] Error getting type for symbol ${symbolNameToCheck}:`, e);
			return;
		}

		if (!type) {

			return;
		}

		const isPromise = isPromiseType(type, typeChecker);
		const isFunction = isFunctionType(type);
		console.log('debug isPromiseisFunction', symbol.getName(), isPromise, isFunction)
		let returnsPromise = false;
		if (isFunction && !isPromise) {
			returnsPromise = type.getCallSignatures().some(signature => {
				return isPromiseType(signature.getReturnType(), typeChecker);
			});

		}

		if ((isPromise || returnsPromise)) {

			const textBeforeSymbol = lineText.slice(0, symbolPosition?.character ?? position.character);
			const hasAwait = /\bawait\b\s*$/.test(textBeforeSymbol.trim());


			if (!hasAwait) {
				const insertPos = symbolPosition || position;

				isInsertingAwait = true;
				// insert await
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
				isInsertingAwait = false;
			} else {

			}
		} else {

		}
	}));


	const provider = vscode.languages.registerCompletionItemProvider(
		{ scheme: 'file', language: 'typescript' },
		{
			async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext) {

				// ignore ctrl+space
				const linePrefix1 = document.lineAt(position).text.substring(0, position.character);
				if (linePrefix1.length === 0) {
					return undefined;
				}
				const lastChar = linePrefix1[linePrefix1.length - 1];
				if (invalidVarCharsRegex.test(lastChar)) {
					return undefined;
				}

				if (!projectInstance) {
					const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
					const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.dirname(document.fileName);

					let tsconfigPath: string | undefined;

					try {
						const filesInRoot = await vscode.workspace.fs.readDirectory(vscode.Uri.file(projectRoot));
						for (const [name, type] of filesInRoot) {
							if (name === 'tsconfig.json' && type === vscode.FileType.File) {
								tsconfigPath = path.join(projectRoot, name);
								break;
							}
						}

						if (tsconfigPath) {
							projectInstance = new Project({
								tsConfigFilePath: tsconfigPath,
							});
						} else {
							projectInstance = new Project({
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
					} catch (e) {

						projectInstance = new Project({
							compilerOptions: {
								target: ScriptTarget.ESNext,
								module: ModuleKind.CommonJS,
							}
						});
					}
				}

				let sourceFile = projectInstance.getSourceFile(document.fileName);
				if (!sourceFile) {
					sourceFile = projectInstance.createSourceFile(document.fileName, document.getText(), { overwrite: true });
				} else {
					sourceFile.replaceWithText(document.getText());
				}

				const offset = document.offsetAt(position);
				const nodeAtCursor = sourceFile.getDescendantAtPos(offset);

				if (!nodeAtCursor) {
					return undefined;
				}

				const completions: vscode.CompletionItem[] = [];
				const typeChecker = projectInstance.getTypeChecker();

				const currentWordRange = document.getWordRangeAtPosition(position);
				const currentWord = currentWordRange ? document.getText(currentWordRange) : '';
				const linePrefix = document.lineAt(position).text.slice(0, position.character);
				const hasAwait = /\bawait\b\s*$/.test(linePrefix.trim());

				const symbolsInScope = typeChecker.getSymbolsInScope(
					nodeAtCursor,
					ts.SymbolFlags.Function | ts.SymbolFlags.Variable | ts.SymbolFlags.Alias | ts.SymbolFlags.Property
				);

				for (const symbol of symbolsInScope) {
					const name = symbol.getName();

					if (name.startsWith('__') || (currentWord && !name.startsWith(currentWord))) {
						continue;
					}

					let type: Type | undefined;
					try {
						type = symbol.getTypeAtLocation(nodeAtCursor);
					} catch (e) {
						type = undefined;
					}

					if (!type) {
						continue;
					}


					const isPromise = isPromiseType(type, typeChecker);
					const isFunction = isFunctionType(type);

					let returnsPromise = false;
					if (isFunction && !isPromise) {
						returnsPromise = type.getCallSignatures().some(signature => {
							return isPromiseType(signature.getReturnType(), typeChecker);
						});

					}

					if (!isPromise && !isFunction && !returnsPromise) {
						continue;
					}

					const completionKind = isFunction ? vscode.CompletionItemKind.Function : vscode.CompletionItemKind.Variable;
					const completion = new vscode.CompletionItem(name, completionKind);

					let insertText = name;
					let needsTriggerParameterHints = false;

					if (isFunction) {
						const callSignatures = type.getCallSignatures();
						if (callSignatures.length > 0) {
							const signature = callSignatures[0];
							const parameters = signature.getParameters();

							let requiredParams: string[] = [];
							let tabStopCounter = 1;

							for (const paramSymbol of parameters) {
								const paramDeclaration = paramSymbol.getDeclarations()?.[0];
								if (paramDeclaration && Node.isParameterDeclaration(paramDeclaration)) {
									const isOptional = paramDeclaration.isOptional() || paramDeclaration.hasInitializer();
									const isRest = paramDeclaration.isRestParameter();

									if (!isOptional && !isRest) {
										requiredParams.push(`$${tabStopCounter}`);
										tabStopCounter++;
									}
								}
							}

							if (requiredParams.length > 0) {
								insertText += `(${requiredParams.join(', ')})$0`;
								needsTriggerParameterHints = true;
							} else {
								insertText += '()$0';
							}
						} else {
							insertText += '()$0';
						}
					} else {
						insertText += '$0';
					}

					if ((isPromise || returnsPromise) && !hasAwait) {
						insertText = 'await ' + insertText;

					} else {

					}

					completion.insertText = new vscode.SnippetString(insertText);
					completion.sortText = '!' + name;

					if (needsTriggerParameterHints) {
						completion.command = {
							command: 'editor.action.triggerParameterHints',
							title: 'Trigger Parameter Hints'
						};
					}

					if (currentWordRange) {
						completion.range = currentWordRange;
					}

					const typeString = typeChecker.getTypeText(type);
					completion.detail = `${(isPromise || returnsPromise) ? 'async ' : ''}${name}: ${typeString}`;
					completion.documentation = new vscode.MarkdownString(
						(isPromise || returnsPromise) ? 'Auto-awaited Promise returning function/variable' : 'Function/variable'
					);

					completions.push(completion);
				}

				return completions;
			}
		},
		'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$'
	);

	context.subscriptions.push(provider);

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
			console.log('debug insertOffset', insertOffset)
			const insertPosition = document.positionAt(insertOffset);
			return { isInAsyncContext: false, insertPosition: insertPosition };
		}
	}

	return { isInAsyncContext: false };
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

function isPromiseType(type: Type, typeChecker: TypeChecker): boolean {
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
			if (isPromiseType(arg, typeChecker)) {
				return true;
			}
		}
	}

	if (type.getCallSignatures().length > 0) {
		return type.getCallSignatures().some(signature => {
			const returnType = signature.getReturnType();
			return isPromiseType(returnType, typeChecker);
		});
	}

	if (type.isUnion()) {
		return type.getUnionTypes().some(t =>
			isPromiseType(t, typeChecker)
		);
	}

	const baseTypes = type.getBaseTypes() || [];
	for (const baseType of baseTypes) {
		if (isPromiseType(baseType, typeChecker)) {
			return true;
		}
	}

	return false;
}

function isFunctionType(type: Type): boolean {
	if (!type) { return false; }
	return type.getCallSignatures().length > 0;
}

export function deactivate() {

	projectInstance = undefined;
}


function isFunctionCallFormat(str: string): string | undefined {
	const regex = /^\.?\s*([a-zA-Z_]\w*)\s*\(([^()]*)\)\s*$/;

	const match = str.match(regex);
	if (!match) { return; }

	const funcName = match[1];
	return funcName;
}

interface FunctionSymbolInfo {
	symbol: TsMorphSymbol;
	symbolPosition: vscode.Position;
	calledSymbolPosition: vscode.Position;
}


function getSymbolBeforeCursor(
	document: vscode.TextDocument,
	position: vscode.Position,
	project: Project,
	sourceFile: SourceFile
): { symbol: TsMorphSymbol; symbolPosition: vscode.Position } | undefined {
	const fileContent = document.getText();
	const offset = document.offsetAt(position);

	let currentNode = sourceFile.getDescendantAtPos(offset);

	let callExpression: CallExpression | undefined;
	while (currentNode) {
		if (currentNode.isKind(SyntaxKind.CallExpression)) {
			callExpression = currentNode as CallExpression;
			if (offset >= callExpression.getStart() && offset <= callExpression.getEnd()) {
				break;
			}
		}
		currentNode = currentNode.getParent();
	}

	if (!callExpression) {
		const textBeforeCursor = fileContent.substring(0, offset);
		const lastParenIndex = textBeforeCursor.lastIndexOf('(');
		if (lastParenIndex !== -1) {
			const potentialExpressionText = textBeforeCursor.substring(0, lastParenIndex).trimEnd();
			if (potentialExpressionText.length > 0) {
				const tempSourceFile = project.createSourceFile("temp2.ts", `(${potentialExpressionText})`);
				const tempNode = tempSourceFile.getFirstChildByKind(SyntaxKind.ParenthesizedExpression)?.getExpression();

				if (tempNode?.isKind(SyntaxKind.Identifier)) {
					const identifierOffset = offset - tempNode.getWidth() - 1;
					const identifierNode = sourceFile.getDescendantAtPos(identifierOffset);
					if (identifierNode?.isKind(SyntaxKind.Identifier) && identifierNode.getText() === tempNode.getText()) {
						return { symbol: identifierNode.getSymbol()!, symbolPosition: document.positionAt(identifierNode.getStart()) };
					}
				} else if (tempNode?.isKind(SyntaxKind.PropertyAccessExpression)) {
					const propertyAccessOffset = offset - tempNode.getWidth() - 1;
					const propertyAccessNode = sourceFile.getDescendantAtPos(propertyAccessOffset);
					if (propertyAccessNode?.isKind(SyntaxKind.PropertyAccessExpression)) {
						const nameNode = (propertyAccessNode as PropertyAccessExpression).getNameNode();
						if (nameNode.getText() === (tempNode as PropertyAccessExpression).getNameNode().getText()) {
							return { symbol: nameNode.getSymbol()!, symbolPosition: document.positionAt(propertyAccessNode.getStart()) };
						}
					}
				}
			}
		}
		return undefined;
	}

	const expression = callExpression.getExpression();
	let targetIdentifier: Identifier | undefined;

	if (expression.isKind(SyntaxKind.Identifier)) {
		targetIdentifier = expression as Identifier;
	} else if (expression.isKind(SyntaxKind.PropertyAccessExpression)) {
		targetIdentifier = (expression as PropertyAccessExpression).getNameNode();
	}

	if (targetIdentifier) {
		const insertOffset = callExpression.getStart();
		const insertPosition = document.positionAt(insertOffset);

		return {
			symbol: targetIdentifier.getSymbol()!, // make user symbol exists
			symbolPosition: insertPosition
		};
	}

	return undefined;
}