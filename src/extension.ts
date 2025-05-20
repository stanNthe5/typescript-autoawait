import * as fs from 'fs';
import * as path from 'path';
// Import necessary types: Node, FunctionKeyword, OpenParenToken
import { ArrowFunction, FunctionDeclaration, FunctionExpression, Node, Project, SyntaxKind } from 'ts-morph';
import * as vscode from 'vscode';

const SKIP_AWAIT_MARKER = 'promise';

let cachedProject: Project | null = null;

function getProject(tsconfigPath: string): Project {
	if (!cachedProject) {
		cachedProject = new Project({
			tsConfigFilePath: tsconfigPath, // can replace with workspace tsconfig 
			//   skipFileDependencyResolution: true,
		});
	}
	return cachedProject;
}

export function activate(context: vscode.ExtensionContext) {
	console.log('plugin enabled');

	const saveListener = vscode.workspace.onWillSaveTextDocument(async (event) => {
		const document = event.document;
		const filePath = document.fileName;
		// Only process TypeScript/TSX files
		if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) {
			return;
		}

		// Dynamic tsconfig.json lookup (moving up directories)
		let currentDir = path.dirname(filePath);
		let tsconfigPath: string | undefined;

		// Loop up to the root directory
		while (currentDir !== path.dirname(currentDir)) {
			const candidate = path.join(path.join(currentDir, 'tsconfig.json'));
			if (fs.existsSync(candidate)) {
				tsconfigPath = candidate;
				break;
			}
			currentDir = path.dirname(currentDir);
		}

		// Exit if tsconfig.json is not found
		if (!tsconfigPath) {
			console.log(`can not find  tsconfig.json。skip async/await checking.`);
			return; // Exit the listener for this file
		}

		const content = document.getText();
		const edits: vscode.TextEdit[] = [];

		// Project is only created if tsconfig.json is found
		// const project = new Project({
		// 	tsConfigFilePath: tsconfigPath,
		// });
		const project = getProject(tsconfigPath);

		// Add the source file to the project
		const sourceFile = project.createSourceFile(filePath, content, { overwrite: true });

		// Find all call expressions in the file
		const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

		// Keep track of functions we've already decided to make async
		const functionsToMakeAsync = new Set<Node>(); // Use Node reference

		for (const call of calls) {
			try {
				const returnType = call.getReturnType();

				// Check if the call's parent is an AwaitExpression
				const isAwaited = call.getParentIfKind(SyntaxKind.AwaitExpression) !== undefined;

				// Determine if the return type is a function (by checking call signatures)
				const isFunctionType = returnType.getCallSignatures().length > 0;

				// Determine if the return type is a Promise directly
				// It's a direct Promise if its text includes 'Promise' AND it's NOT a function type
				const returnsDirectPromise = returnType.getText().includes('Promise') && !isFunctionType;

				// Determine if the return type is a function that returns a Promise
				let returnsFunctionReturningPromise = false;
				if (isFunctionType) {
					// If it's a function type, check if any of its signatures return a Promise
					for (const signature of returnType.getCallSignatures()) {
						const signatureReturnType = signature.getReturnType();
						if (signatureReturnType.getText().includes('Promise')) {
							returnsFunctionReturningPromise = true;
							break; // Found a signature that returns a Promise
						}
					}
				}

				// Add 'await' ONLY if it's a direct Promise-returning call, it's missing, and not explicitly skipped
				if (returnsDirectPromise) {
					let shouldSkipAwait = false;
					const containingStatement = call.getFirstAncestor(Node.isStatement);

					if (containingStatement) {
						// Check leading comments (comments before the statement)
						const leadingComments = containingStatement.getLeadingCommentRanges();
						for (const comment of leadingComments) {
							if (comment.getText().includes(SKIP_AWAIT_MARKER)) {
								shouldSkipAwait = true;
								break;
							}
						}

						// Check trailing comments (comments on the same line after the statement)
						if (!shouldSkipAwait) {
							const trailingComments = containingStatement.getTrailingCommentRanges();
							for (const comment of trailingComments) {
								if (comment.getText().includes(SKIP_AWAIT_MARKER)) {
									shouldSkipAwait = true;
									break;
								}
							}
						}
					}
					// Add 'await' ONLY if it's missing and not explicitly skipped
					if (!isAwaited && !shouldSkipAwait) {
						const insertPos = document.positionAt(call.getStart());
						edits.push(vscode.TextEdit.insert(insertPos, 'await '));
						console.log(`在 ${sourceFile.getFilePath()}:${call.getStartLineNumber()} 添加 await`);
					}

					// Find the nearest parent function (declaration, expression, or arrow)
					const parentFn = call.getFirstAncestor(node =>
						node.getKind() === SyntaxKind.FunctionDeclaration ||
						node.getKind() === SyntaxKind.FunctionExpression ||
						node.getKind() === SyntaxKind.ArrowFunction
					);

					if (parentFn) {
						const fn = parentFn as FunctionDeclaration | FunctionExpression | ArrowFunction;

						// Add 'async' if the parent is NOT already async AND we haven't marked it yet
						if (!fn.isAsync() && !functionsToMakeAsync.has(fn)) {
							let asyncInsertPos = document.positionAt(fn.getStart()); // Default insertion point

							// Determine the precise insertion point for 'async'
							if (fn.getKind() === SyntaxKind.ArrowFunction) {
								// Find the opening parenthesis for arrow functions with explicit params
								const openParen = fn.getFirstChildByKind(SyntaxKind.OpenParenToken);
								if (openParen) {
									// If parentheses exist: `(param) => {}`
									asyncInsertPos = document.positionAt(openParen.getStart());
								} else {
									// If no parentheses: `param => {}` or `=> {}` (rare/invalid)
									// The node's start position is typically at the start of the parameter
									// identifier. Inserting 'async ' here is correct.
									asyncInsertPos = document.positionAt(fn.getStart());
								}
							} else { // FunctionDeclaration or FunctionExpression
								// Find the 'function' keyword for standard functions
								const functionKeyword = fn.getFirstChildByKind(SyntaxKind.FunctionKeyword);
								if (functionKeyword) {
									asyncInsertPos = document.positionAt(functionKeyword.getStart());
								} else {
									// Fallback: start of the node (shouldn't happen for valid syntax)
									asyncInsertPos = document.positionAt(fn.getStart());
								}
							}

							// Add the 'async ' edit
							edits.push(vscode.TextEdit.insert(asyncInsertPos, 'async '));
							console.log(`在 ${sourceFile.getFilePath()}:${fn.getStartLineNumber()} 添加 async`);

							// Mark this function so we don't add 'async' again during this save
							functionsToMakeAsync.add(fn);
						}
					} else {

					}
				} else if (returnsFunctionReturningPromise) {
					console.log(` ${sourceFile.getFilePath()}:${call.getStartLineNumber()} skip await`);
				}
			} catch (error: any) {
				console.error(` ${filePath} : ${error.message}`);
			}
		}

		// If there are edits, apply them before the document is saved
		if (edits.length > 0) {
			console.log(`found ${edits.length} (await/async) in ${filePath}`);
			event.waitUntil(Promise.resolve(edits)); //async
		} else {
			console.log(`no change`);
		}
	});

	// Dispose of the listener when the extension is deactivated
	context.subscriptions.push(saveListener);
}

export function deactivate() {
	console.log('plugin enabled');
}
