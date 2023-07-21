import { Service } from '@volar/language-service';
import { VueFile, walkElementNodes } from '@vue/language-core';
import { NodeTypes } from 'packages/vue-language-core/out/utils/vue2TemplateCompiler';
import type * as vscode from 'vscode-languageserver-protocol';

export default function (): Service {

	return (ctx, modules): ReturnType<Service> => {

		if (!modules?.typescript)
			return {};

		const ts = modules.typescript;

		return {

			provideCodeActions(document, range, _context) {
				const startOffset = document.offsetAt(range.start);
				const endOffset = document.offsetAt(range.end);

				const [vueFile] = ctx!.documents.getVirtualFileByUri(document.uri);
				if (!vueFile || !(vueFile instanceof VueFile)) {
					return;
				}

				const { templateAst, template } = vueFile.sfc;

				if (!templateAst) return;

				const templateStartOffset = template!.startTagEnd;
				const result: vscode.CodeAction[] = [];

				walkElementNodes(templateAst, node => {
					if (startOffset > templateStartOffset + node.loc.end.offset || endOffset < templateStartOffset + node.loc.start.offset) {
						return;
					}
					for (const prop of node.props) {
						if (
							startOffset - templateStartOffset >= prop.loc.start.offset
							&& endOffset - templateStartOffset <= prop.loc.end.offset
						) {
							if (prop.type === NodeTypes.DIRECTIVE && prop.exp) {
								const sourceFile = ts.createSourceFile('/a.ts', prop.exp.loc.source, ts.ScriptTarget.Latest, true);
								const firstStatement = sourceFile.statements[0];
								if (sourceFile.statements.length === 1 && ts.isExpressionStatement(firstStatement) && ts.isStringLiteralLike(firstStatement.expression)) {
									const stringNode = sourceFile.statements[0];
									const removeTextRanges: [number, number][] = [
										[prop.loc.start.offset, prop.loc.start.offset + 1],
										// Work correctly with trivias for cases like <input :type=" 'password' " />
										[prop.exp.loc.start.offset, prop.exp.loc.start.offset + stringNode.pos + stringNode.getLeadingTriviaWidth() + 1],
										[prop.exp.loc.start.offset + stringNode.end - 1, prop.exp.loc.end.offset],
									];
									result.push({
										title: 'Remove v-bind from attribute',
										kind: 'refactor.rewrite.removeVBind',
										edit: {
											changes: {
												[document.uri]: removeTextRanges.map(range => ({
													newText: '',
													range: {
														start: document.positionAt(templateStartOffset + range[0]),
														end: document.positionAt(templateStartOffset + range[1]),
													}
												}))
											},
										},
									});
								}
							}
							if (
								prop.type === NodeTypes.ATTRIBUTE
							) {
								const addVBindPos = document.positionAt(templateStartOffset + prop.loc.start.offset);
								const edits: vscode.TextEdit[] = [];
								let newPosition: vscode.Position | undefined;
								edits.push({
									newText: ':',
									range: {
										start: addVBindPos,
										end: addVBindPos
									},
								});
								if (!prop.value) {
									const addValuePos = document.positionAt(templateStartOffset + prop.loc.end.offset);
									edits.push({
										newText: '=""',
										range: {
											start: addValuePos,
											end: addValuePos
										},
									});
									newPosition = {
										line: addValuePos.line,
										character: addValuePos.character + ':'.length + '="'.length,
									};
								}
								result.push({
									title: 'Add v-bind to attribute',
									kind: 'refactor.rewrite.addVBind',
									edit: {
										changes: { [document.uri]: edits },
									},
									command: newPosition ? ctx?.commands.setSelection.create(newPosition) : undefined,
								});
							}
						}
					}
				});

				return result;
			}
		};
	};
}
