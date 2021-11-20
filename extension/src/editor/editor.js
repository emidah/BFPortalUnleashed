"use strict";
const supportedLocales = ["de", "es", "fr", "hu", "it", "ja", "ko", "pr-br", "ru", "tr", "zh-cn", "zh-tw"];
var editor;
var editableActionRegistration;

// Listen to messages from the content script.
window.addEventListener("message", handleLaunchEvent);

chrome.runtime.onMessage.addListener(function(call) {
    if (call.action === "set_theme") {
        monaco.editor.setTheme(call.content);
    }
});

function handleLaunchEvent(event) {
    const message = event.data;
    if (typeof message.code !== "undefined") {
        require.config({
            paths: {
                vs: "../lib/monaco-editor/min/vs",
            },
        });

        const userLocale = getUserLocale();
        if (userLocale !== null) {
            require.config({
                "vs/nls": {
                    availableLanguages: {
                        "*": userLocale,
                    },
                },
            });
        }

        require(["vs/editor/editor.main"], function() {
            prepareAndLaunchEditor(message);
        });
    }
}

function getUserLocale() {
    const languageTag = chrome.i18n.getUILanguage().toLowerCase();
    // Extract ISO 639-1 language abbreviation.
    const languageCode = languageTag.substr(0, languageTag.indexOf("-"));
    if (supportedLocales.indexOf(languageCode) >= 0) {
        return languageCode;
    } else if (supportedLocales.indexOf(languageTag) >= 0) {
        return languageTag;
    }
    return null;
}

function prepareAndLaunchEditor(message) {
    chrome.storage.local.get(["editable", "theme"], function(state) {
        const mappedLanguage = getLanguageForFilename(message.filename);
        const theme = state["theme"] || "vs";

        if (mappedLanguage === null) {
            // Couldn't map a language based on filename, try to use MIME type.
            chrome.runtime.sendMessage({ action: "get_content_type" }, function(response) {
                let mimeSubtype;
                if (typeof response.contentType !== "undefined") {
                    mimeSubtype = /.*\/([^;]*)/.exec(response.contentType)[1];
                }
                // If mimeSubtype undefined, Monaco will use default language
                // settings.
                launchEditor(message.code, mimeSubtype, theme);
            });
        } else {
            launchEditor(message.code, mappedLanguage, theme);
        }
    });
}

function getLanguageForFilename(filename) {
    for (const language of monaco.languages.getLanguages()) {
        for (const monacoExtension of language.extensions) {
            if (filename.endsWith(monacoExtension)) {
                return language.id;
            }
        }
    }
    return null;
}

function errorHandler(err) {
    console.error(err)
}

function launchEditor(code, inferredLanguage, theme) {
    editor = monaco.editor.create(document.getElementById("container"), {
        value: code,
        scrollBeyondLastLine: false,
        language: inferredLanguage,
        cursorBlinking: "smooth",
        dragAndDrop: true,
        mouseWheelZoom: true,
        theme: theme,
    });
    addExportAction();
    addRunAction();
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true
    });

    var url = chrome.runtime.getURL("lib/portal-unleashed/dist/unleash.d.ts")
    fetch(url)
        .then((response) => response.text())
        .then((text) => {
            monaco.languages.typescript.typescriptDefaults.addExtraLib(text, "")
        }).catch(errorHandler);

    // Avoid using Monaco's automaticLayout option for better performance.
    window.addEventListener("resize", function() {
        editor.layout();
    });
}

function addExportAction() {
    editor.addAction({
        id: "export",
        label: "Export content",
        contextMenuGroupId: "1_menu",
        contextMenuOrder: 2,
        run: function() {
            chrome.runtime.sendMessage({
                action: "download_content",
                content: editor.getValue(),
            });
        },
    });
}

function addRunAction() {
    editor.addAction({
        id: "run",
        label: "Run",
        contextMenuGroupId: "1_menu",
        contextMenuOrder: 2,
        run: function() {
            let code = editor.getValue()
                // TODO: pre-process code here
            window.parent.postMessage("run+" + code, "*");
        },
    });
}

function toggleEditable(oldState) {
    const newState = !oldState;
    editor.updateOptions({
        readOnly: !newState,
    });
    chrome.storage.local.set({
        editable: newState ? "true" : "false",
    });
    addOrUpdateEditableAction(newState);
}

// Signal to content script that this editor is ready to be launched.
window.parent.postMessage("loaded", "*");