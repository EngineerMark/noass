import { saveSettingsDebounced, substituteParamsExtended, updateMessageBlock, chat, this_chid, stopGeneration } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { addEphemeralStoppingString, flushEphemeralStoppingStrings } from '../../../power-user.js';
import { download, getFileText } from '../../../utils.js';
import { promptManager, Message, MessageCollection } from '../../../openai.js';
import { getMessageTimeStamp } from '../../../RossAscends-mods.js';

const { eventSource, event_types, callPopup, renderExtensionTemplateAsync, saveChat } = SillyTavern.getContext();

const defaultSet = {
    name: 'Default',
    enable_stop_string: true,
    stop_string: '**{{user}}:**',
    messages_separator: 'double_newline',
    user_prefix: '**{{user}}:** ',
    user_suffix: '',
    char_prefix: '',
    char_suffix: '',
    zero_prefill: ""
};

const defaultSettings = {
    noass_is_enabled: false,
    enable_zero_prefill: false,
    squash_role: 'assistant',
    client_stop_string: false,
    active_set: 'Default',
    active_set_idx: 0,
    sets: [getDefaultSet()]
};

const MessageRole = {
    SYSTEM: 'system',
    USER: 'user',
    ASSISTANT: 'assistant'
}

const defaultExtPrefix = '[NoAss]';
const path = 'third-party/noass';

let cachedStopString;
let clientStopStringTriggered = false;

function getDefaultSet() {
    return JSON.parse(JSON.stringify(defaultSet));
}

function updateOrInsert(jsonArray, newJson) {
    const index = jsonArray.findIndex(item => item.name === newJson.name);
    if (index !== -1) {
        jsonArray[index] = newJson;
        return index;
    } else {
        jsonArray.push(newJson);
        return jsonArray.length - 1;
    }
}

function removeAfterSubstring(str, substring) {
    const index = str.indexOf(substring);
    if (index === -1) {
        return str;
    }
    return str.slice(0, index);
}

function clientStopStringHandler(text) {
    if (extension_settings.NoAss.client_stop_string && extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx].enable_stop_string) {
        if (cachedStopString === undefined) {
            const activeSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
            const { stop_string } = activeSet;

            if (stop_string) {
                cachedStopString = substituteParamsExtended(stop_string);
            }
        }
        
        if (cachedStopString !== undefined && text.includes(cachedStopString)) {
            clientStopStringTriggered = true;
            stopGeneration();
        }
    }
}

function refreshSetList() {
    const setsName = extension_settings.NoAss.sets.map(obj => obj.name);
    const $presetList = $('#NoAss-preset-list').empty();
    setsName.forEach(option => {
        $presetList.append($('<option>', { value: option, text: option }));
    });
    $presetList.val(extension_settings.NoAss.active_set);
}


async function changeSet(idx) {
    const set_name = extension_settings.NoAss.sets[idx].name;
    extension_settings.NoAss.active_set = set_name;
    extension_settings.NoAss.active_set_idx = idx;
    refreshSetList();
    loadSetParameters();
    saveSettingsDebounced();
}

async function importSet(file) {
    if (!file) {
        toastr.error('No file provided.');
        return;
    }

    try {
        const fileText = await getFileText(file);
        const noAssSet = JSON.parse(fileText);
        if (!noAssSet.name) throw new Error('No name provided.');

        const setIdx = updateOrInsert(extension_settings.NoAss.sets, noAssSet);
        await changeSet(setIdx);
        checkSettings();
        toastr.success(`NoAss set "${noAssSet.name}" imported.`);
    } catch (error) {
        console.error(error);
        toastr.error('Invalid JSON file.');
    }
}

function checkSettings() {
    const noAssSettings = extension_settings.NoAss;
    Object.assign(noAssSettings, {
        enable_zero_prefill: noAssSettings.enable_zero_prefill ?? defaultSettings.enable_zero_prefill,
        client_stop_string: noAssSettings.client_stop_string ?? defaultSettings.client_stop_string,
        squash_role: noAssSettings.squash_role ?? defaultSettings.squash_role,
        active_set: noAssSettings.active_set ?? defaultSettings.active_set,
        active_set_idx: noAssSettings.active_set_idx ?? defaultSettings.active_set_idx,
        sets: noAssSettings.sets ?? [getDefaultSet()]
    });

    if (!noAssSettings.sets.length) {
        const currentActiveSetIdx = noAssSettings.active_set_idx;
        ['messages_separator', 'user_prefix', 'user_suffix', 'char_prefix', 'char_suffix', 'zero_prefill'].forEach(key => {
            if (noAssSettings[key] !== undefined) {
                noAssSettings.sets[currentActiveSetIdx][key] = noAssSettings[key];
                delete noAssSettings[key];
            }
        });
    }

    for (let idx = 0; idx < noAssSettings.sets.length; idx++) {
        if (noAssSettings.sets[idx].enable_stop_string === undefined) {
            noAssSettings.sets[idx].enable_stop_string = defaultSet.enable_stop_string;
        }
    }

    saveSettingsDebounced();
}

function loadSetParameters() {
    const currentSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
    const replaceNewlines = str => str.replace(/\n/g, '\\n');

    $('#noass_is_enabled').prop('checked', extension_settings.NoAss.noass_is_enabled);
    $('#noass_enable_zero_prefill').prop('checked', extension_settings.NoAss.enable_zero_prefill);
    $('#noass_squash_role').val(extension_settings.NoAss.squash_role);
    $('#noass_enable_stop_string').prop('checked', currentSet.enable_stop_string);
    $('#noass_client_stop_string').prop('checked', extension_settings.NoAss.client_stop_string);
    $('#noass_stop_string').val(currentSet.stop_string);
    $('#noass_messages_separator').val(currentSet.messages_separator);
    $('#noass_user_prefix').val(replaceNewlines(currentSet.user_prefix));
    $('#noass_user_suffix').val(replaceNewlines(currentSet.user_suffix));
    $('#noass_char_prefix').val(replaceNewlines(currentSet.char_prefix));
    $('#noass_char_suffix').val(replaceNewlines(currentSet.char_suffix));
    $('#noass_zero_prefill').val(currentSet.zero_prefill);
}

function loadSettings() {
    if (!extension_settings.NoAss) {
        extension_settings.NoAss = defaultSettings;
    };

    checkSettings();
    refreshSetList();
    loadSetParameters();
}

function setupListeners() {
    const noAssSettings = extension_settings.NoAss;

    $('#noass_is_enabled').off('click').on('click', () => {
        noAssSettings.noass_is_enabled = $('#noass_is_enabled').prop('checked');
        if (!noAssSettings.noass_is_enabled) flushEphemeralStoppingStrings();
        saveSettingsDebounced();
    });

    $('#noass_enable_zero_prefill').off('click').on('click', () => {
        noAssSettings.enable_zero_prefill = $('#noass_enable_zero_prefill').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_client_stop_string').off('click').on('click', () => {
        noAssSettings.client_stop_string = $('#noass_client_stop_string').prop('checked');
        saveSettingsDebounced();
    });

    $('#noass_squash_role').off('change').on('change', () => {
        noAssSettings.squash_role = $('#noass_squash_role').val();
        saveSettingsDebounced();
    });

    $('#NoAss-preset-list').off('change').on('change', async () => {
        await changeSet($('#NoAss-preset-list').prop('selectedIndex'));
    });

    $('#NoAss-preset-new').on('click', async () => {
        const newSetHtml = $(await renderExtensionTemplateAsync(path, 'new_set_popup'));
        const popupResult = await callPopup(newSetHtml, 'confirm', undefined, { okButton: 'Save' });
        if (popupResult) {
            const newSet = getDefaultSet();
            newSet.name = String(newSetHtml.find('.NoAss-newset-name').val());
            const setIdx = updateOrInsert(noAssSettings.sets, newSet);
            await changeSet(setIdx);
        }
    });

    $('#NoAss-preset-importFile').on('change', async function () {
        for (const file of this.files) {
            await importSet(file);
        }
        this.value = '';
    });

    $('#NoAss-preset-import').on('click', () => {
        $('#NoAss-preset-importFile').trigger('click');
    });

    $('#NoAss-preset-export').on('click', () => {
        const currentSet = noAssSettings.sets[noAssSettings.active_set_idx];
        const fileName = `${currentSet.name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, '_').toLowerCase()}.json`;
        const fileData = JSON.stringify(currentSet, null, 4);
        download(fileData, fileName, 'application/json');
    });

    $('#NoAss-preset-delete').on('click', async () => {
        const confirm = await callPopup('Are you sure you want to delete this set?', 'confirm');
        if (!confirm) return;

        noAssSettings.sets.splice(noAssSettings.active_set_idx, 1);
        if (noAssSettings.sets.length) {
            changeSet(0);
        } else {
            const setIdx = updateOrInsert(noAssSettings.sets, getDefaultSet());
            changeSet(setIdx);
        }
    });

    $('#noass_enable_stop_string').off('click').on('click', () => {
        const value = $('#noass_enable_stop_string').prop('checked');
        if (!value) {
            flushEphemeralStoppingStrings();
        }
        noAssSettings.sets[noAssSettings.active_set_idx].enable_stop_string = value
        saveSettingsDebounced();
    });

    const inputListeners = [
        { selector: '#noass_stop_string', key: 'stop_string' },
        { selector: '#noass_user_prefix', key: 'user_prefix', replaceNewlines: true },
        { selector: '#noass_user_suffix', key: 'user_suffix', replaceNewlines: true },
        { selector: '#noass_char_prefix', key: 'char_prefix', replaceNewlines: true },
        { selector: '#noass_char_suffix', key: 'char_suffix', replaceNewlines: true },
        { selector: '#noass_zero_prefill', key: 'zero_prefill' }
    ];

    inputListeners.forEach(({ selector, key, replaceNewlines }) => {
        $(selector).off('input').on('input', () => {
            let value = $(selector).val();
            if (replaceNewlines) value = value.replace(/\\n/g, '\n');
            noAssSettings.sets[noAssSettings.active_set_idx][key] = value;
            saveSettingsDebounced();
        });
    });

    $('#noass_messages_separator').off('change').on('change', () => {
        noAssSettings.sets[noAssSettings.active_set_idx].messages_separator = $('#noass_messages_separator').val();
        saveSettingsDebounced();
    });
}

if (!('CHAT_COMPLETION_PROMPT_READY' in event_types)) {
    toastr.error('Required event types not found: CHAT_COMPLETION_PROMPT_READY. Update SillyTavern to the >=1.12 version.');
    throw new Error('Events not found.');
}

function isChatCompletion() {
    return SillyTavern.getContext().mainApi === 'openai';
}

function getSendDate(idx) {
    if (idx !== undefined && idx < chat.length) {
        return this_chid ? chat[idx]?.send_date : '';
    }
    return getMessageTimeStamp();
}

function getChat(messages) {
    const assembled_chat = [];
    for (let item of messages) {
        if (item instanceof MessageCollection) {
            assembled_chat.push(...item.getChat());
        } else if (item instanceof Message && (item.content || item.tool_calls)) {
            const message = {
                role: item.role,
                content: item.content,
                ...(item.name ? { name: item.name } : {}),
                ...(item.tool_calls ? { tool_calls: item.tool_calls } : {}),
                ...(item.role === 'tool' ? { tool_call_id: item.identifier } : {}),
            };
            assembled_chat.push(message);
        } else {
            console.log(`Skipping invalid or empty message in collection: ${JSON.stringify(item)}`);
        }
    }
    return assembled_chat;
}

function splitArrayByChatHistory(arr) {
    if (!Array.isArray(arr)) {
        return [[], [], []];
    }

    let startIndex = -1;
    let endIndex = -1;

    for (let i = 0; i < arr.length; i++) {
        if (!arr[i]) {
            continue;
        } else if (typeof arr[i].identifier === 'string' && arr[i].identifier.includes("chatHistory")) {
            if (startIndex === -1) {
                startIndex = i;
            }
            endIndex = i;
        } else if (startIndex !== -1) {
            break;
        }
    }

    if (startIndex === -1) {
        return [arr, [], []];
    }

    const before = arr.slice(0, startIndex);
    const chatHistory = arr.slice(startIndex, endIndex + 1);
    const after = arr.slice(endIndex + 1);

    return [before, chatHistory, after];
}

function filterUndefined(arr) {
    return arr.filter(element => element !== undefined);
  }
  

function mergeMessagesByRole(messages, separator) {
    const mergedMessages = [];
    if (messages.length === 0) {
        return mergedMessages;
    }

    mergedMessages.push({ ...messages[0] });

    for (let i = 1; i < messages.length; i++) {
        if (messages[i].role === mergedMessages[mergedMessages.length - 1].role) {
            mergedMessages[mergedMessages.length - 1].content += separator + messages[i].content;
        } else {
            mergedMessages.push({ ...messages[i] });
        }
    }

    return mergedMessages;
}

eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, async (data) => {
    if (!extension_settings.NoAss.noass_is_enabled || !isChatCompletion()) return;
    cachedStopString = undefined;
    clientStopStringTriggered = false;

    console.debug(`${defaultExtPrefix} Updating prompt`);

    const activeSet = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx];
    const { zero_prefill, stop_string, enable_stop_string } = activeSet;
    const separator = { newline: '\n', space: ' ' }[activeSet.messages_separator] || '\n\n';

    flushEphemeralStoppingStrings();
    if (stop_string && enable_stop_string && !extension_settings.NoAss.client_stop_string) {
        addEphemeralStoppingString(substituteParamsExtended(stop_string));
        if (extension_settings.NoAss.paste_prefill && stop_string.startsWith(zero_prefill)) {
            addEphemeralStoppingString(substituteParamsExtended(stop_string.replace(zero_prefill, "")));
        }
    }

    let messages = filterUndefined([...promptManager.messages.collection]);
    const [beforeChatRaw, chatHistoryRaw, afterChatRaw] = splitArrayByChatHistory(messages);
    const chatHistory = mergeMessagesByRole(getChat(chatHistoryRaw), separator);
    const chatHistorySquashed = chatHistory.reduce((history, message, idx) => {
        if(history === '') return `${message.content}`;
        let prefix;
        let suffix;
        const timestampDict = { timestamp: getSendDate(idx) };
        switch (message.role) {
            case MessageRole.USER:
                prefix = substituteParamsExtended(activeSet.user_prefix, timestampDict);
                suffix = substituteParamsExtended(activeSet.user_suffix, timestampDict);
                break;
            case MessageRole.ASSISTANT:
                prefix = substituteParamsExtended(activeSet.char_prefix, timestampDict);
                suffix = substituteParamsExtended(activeSet.char_suffix, timestampDict);
                break;
            default:
                prefix = '';
                suffix = '';
        }
        return `${history}${separator}${prefix}${message.content}${suffix}`;
    }, '');
    const chatHistoryMessage = {
        role: extension_settings.NoAss.squash_role,
        content: chatHistorySquashed,
    };

    const beforeChat = getChat(beforeChatRaw);
    const afterChat = getChat(afterChatRaw);

    if (extension_settings.NoAss.enable_zero_prefill && zero_prefill) {
        afterChat.push({
            role: MessageRole.ASSISTANT,
            content: zero_prefill
        });
    }
    const reassembledChat = mergeMessagesByRole([...beforeChat, chatHistoryMessage, ...afterChat], separator);

    data.chat.length = 0;

    for (let idx = 0; idx < reassembledChat.length; idx++) {
        data.chat.push({ ...reassembledChat[idx] });
    }

    console.debug(`${defaultExtPrefix} Prompt updated`);
});

eventSource.makeFirst(event_types.STREAM_TOKEN_RECEIVED, (text) => {
    if (!extension_settings.NoAss.noass_is_enabled || !isChatCompletion()) return;
    clientStopStringHandler(text);
});

eventSource.makeFirst(event_types.MESSAGE_RECEIVED, async (messageId) => {
    if (!extension_settings.NoAss.noass_is_enabled || !isChatCompletion() || messageId === 0 || this_chid === undefined) return;
    if (clientStopStringTriggered) {
        chat[messageId].mes = removeAfterSubstring(chat[messageId].mes, cachedStopString);
        if (chat[messageId].swipes) {
            chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
        }
        cachedStopString = undefined;
        clientStopStringTriggered = false;
        await saveChat();
    };

    if (extension_settings.NoAss.enable_zero_prefill && !['...', ''].includes(chat[messageId]?.mes)) {
        const zero_prefill = extension_settings.NoAss.sets[extension_settings.NoAss.active_set_idx].zero_prefill;
        if (zero_prefill && !chat[messageId].mes.startsWith(zero_prefill)) {
            chat[messageId].mes = zero_prefill + chat[messageId].mes;
            if (chat[messageId].swipes) {
                chat[messageId].swipes[chat[messageId].swipe_id] = chat[messageId].mes;
            }
            await saveChat();
        }
    };
});

jQuery(async () => {
    $('#extensions_settings').append(await renderExtensionTemplateAsync(path, 'settings'));
    loadSettings();
    setupListeners();
    console.log(`${defaultExtPrefix} extension loaded`);
});
