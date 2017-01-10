/**
 * inspiration:
 * https://github.com/formulahendry/vscode-auto-close-tag/blob/5921f24ffc6fc9350e1ce7c2a74ea99fab0c5b11/src/extension.ts
 * Modified to:
 * - remove options. We are in sublime mode, no excluded tags etc
 * - work with monaco instead of a vscode workspace
 */

import { CompositeDisposible } from "../../../common/events";
import * as monacoUtils from '../monacoUtils';
type Editor = monaco.editor.ICodeEditor;
type TextDocumentContentChangeEvent = monaco.editor.IModelContentChangedEvent2;

export function setup(cm: Editor): { dispose: () => void } {
    const disposible = new CompositeDisposible();
    disposible.add(cm.onDidChangeModelContent((e) => {
        /** Close tag */
        insertAutoCloseTag(e, cm);
    }));

    return disposible;
}

function insertAutoCloseTag(event: TextDocumentContentChangeEvent, editor: Editor): void {
    /** We insert on `</` */
    if (event.text !== "/") {
        return;
    }
    let originalRange = event.range;
    let text = editor.getModel().getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: originalRange.endLineNumber,
        endColumn: originalRange.endColumn,
    });

    let lastChar = "";
    if (text.length > 2) {
        lastChar = text.substr(text.length - 1);
    }
    if (lastChar !== "<") {
        return;
    }

    /** Yay, we have </ See if we have a close tag ? */
    let closeTag = getCloseTag(editor.filePath, editor.getModel().getOffsetAt({
        lineNumber: originalRange.endLineNumber,
        column: originalRange.endColumn
    }));

    if (!closeTag) {
        return;
    }
    /** Yay we have candidate closeTag like `div` */

    /**
     * If the user already has a trailing `>` e.g.
     * before: <div><(pos)>
     * after: <div><(pos)/>
     * Next chars will be `/>`
     */
    const nextChars = getNext2Chars(editor, { lineNumber: originalRange.endLineNumber, column: originalRange.endColumn });

    /** If the next chars are not `/>` then we want to complete `>` for the user as well */
    if (nextChars !== "/>") {
        closeTag = closeTag + '>';
    }

    /** Make edits */
    const startAt = editor.getModel().modifyPosition({
        lineNumber: originalRange.endLineNumber,
        column: originalRange.endColumn
    }, 1);
    monacoUtils.replaceRange({
        model: editor.getModel(),
        range: {
            startLineNumber: startAt.lineNumber,
            startColumn: startAt.column,
            endLineNumber: startAt.lineNumber,
            endColumn: startAt.column
        },
        newText: closeTag
    });

    /** And advance the cursor */
    let endAt = editor.getModel().modifyPosition({
        lineNumber: startAt.lineNumber,
        column: startAt.column
    }, closeTag.length);
    if (nextChars === "/>") {
        /** Advance one char more */
        endAt = editor.getModel().modifyPosition(endAt, 1)
    }
    /** Set timeout. Because it doesn't work otherwise */
    setTimeout(() => {
        editor.setSelection({
            startLineNumber: endAt.lineNumber,
            startColumn: endAt.column,
            endLineNumber: endAt.lineNumber,
            endColumn: endAt.column,
        });
    });

}

function getNext2Chars(editor: Editor, position: monaco.IPosition): string {
    const nextPos = editor.getModel().modifyPosition(position, 2);
    const text = editor.getModel().getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: position.column,
        endLineNumber: nextPos.lineNumber,
        endColumn: nextPos.column,
    });
    return text;
}

import { getSourceFile } from '../model/classifierCache';
function getCloseTag(filePath: string, position: number): string | null {
    const sourceFile = getSourceFile(filePath);
    const opens: ts.JsxOpeningElement[] = [];

    const collectTags = (node: ts.Node) => {
        if (ts.isJsxOpeningElement(node)) {
            if (node.getStart() > position) return;
            opens.push(node);
        }
        if (ts.isJsxClosingElement(node)) {
            if (node.getStart() > position) return;
            /**
             * We don't want the last one as
             * <div></
             *       ^ TS parses this successfully as a closing!
             */
            if (node.getStart() == position && node.getFullText().trim() === '') return;

            opens.pop();
        }
        ts.forEachChild(node, collectTags);
    }
    ts.forEachChild(sourceFile, collectTags);

    if (opens.length) {
        const tabToClose = opens[opens.length - 1]; // close the last one first
        const tabToCloseFullText = tabToClose.getText(); // something like `<foo.Someting>`
        const tabKey = tabToCloseFullText.substr(1, tabToCloseFullText.length - 2); // `foo.something`
        return tabKey;
    }

    return null;
}
