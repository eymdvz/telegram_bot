// == UNISZA Confession Channel Bot - Friday Sedekah Reminder (with Image) ==

const FRIDAY_CONFIG = {
  chatId: '@unijaconfession',
  timeZone: 'Asia/Kuala_Lumpur', // Using a standard timezone name is more robust
  sendMessageHour: 8, // 0800 AM
  unpinMessageHour: 17, // 5:00 PM
  imageUrl: 'https://view.unija.info/media/image/sedekahje.png' // <-- Image URL added here
};

/**
 * Retrieves the bot token from Script Properties.
 * Throws an error if the token is not found.
 */
function getTelegramToken() {
  const token = PropertiesService.getScriptProperties().getProperty('BOT_TOKEN');
  if (!token) {
    throw new Error("Bot token not found. Please set 'BOT_TOKEN' in Project Settings > Script Properties.");
  }
  return token;
}

/**
 * A generic function to make API calls to Telegram.
 * @param {string} methodName The Telegram API method (e.g., 'sendPhoto', 'pinChatMessage').
 * @param {object} payload The data to send with the request.
 * @returns {object|null} The JSON result from the API or null on failure.
 */
function callTelegramApi(methodName, payload) {
  try {
    const token = getTelegramToken();
    const url = `https://api.telegram.org/bot${token}/${methodName}`;
    
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());

    if (result.ok) {
      Logger.log(`✅ API call to '${methodName}' successful.`);
      return result.result;
    } else {
      Logger.log(`❌ Error calling '${methodName}': ${result.description}`);
      return null;
    }
  } catch (e) {
    Logger.log(`❌ Exception during API call to '${methodName}': ${e.message}`);
    return null;
  }
}

/**
 * Sends the Friday message with an image, pins it, and schedules it to be unpinned.
 * This function is meant to be triggered every Friday at 12 PM.
 */
function sendAndPinJumaatMessage() {
  Logger.log("Starting 'sendAndPinJumaatMessage' function.");
  
  const messageCaption = "*Salam Jumaat geng!*\n\n" +
                         "Kalau tengah scroll layan socmed tu, stop jap.\n\n" +
                         "Hari ni hari baik, jom kita buat benda yang baik.\n" +
                         "Sedekah sikit walau RM1 ke mana-mana Masjid.\n\n" +
                         "🕌 Nak pilih sendiri Masjid mana yang anda nak?\n" +
                         "🔗 sedekah.je\n\n" +
                         "Tak tahu nak masjid pilih mana?\n" +
                         "Senang je, klik 🎲 sedekah.je/rawak\n\n" +
                         "Tak berat pun.. klik, scan, auto pahala jalan.\n" +
                         "Jangan tunggu nanti, #SedekahJe hari ni.";

  const payload = {
    chat_id: FRIDAY_CONFIG.chatId,
    photo: FRIDAY_CONFIG.imageUrl, // <-- Use the photo URL
    caption: messageCaption,       // <-- Use caption instead of text
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        {
          text: 'Sedekah.je',
          url: 'http://sedekah.je/'
        }
      ]]
    }
  };

  // Use 'sendPhoto' method instead of 'sendMessage'
  const sentMessage = callTelegramApi('sendPhoto', payload);

  if (sentMessage && sentMessage.message_id) {
    const messageId = sentMessage.message_id;
    Logger.log(`Message sent with photo. Message ID: ${messageId}`);

    // Pin the message
    callTelegramApi('pinChatMessage', {
      chat_id: FRIDAY_CONFIG.chatId,
      message_id: messageId,
      disable_notification: false // Notify users about the pin
    });

    // Schedule the message to be unpinned later
    createUnpinTrigger(messageId);
  } else {
    Logger.log("Failed to send photo message, so pinning and unpinning will not occur.");
  }
}

/**
 * Creates a one-time trigger to unpin a specific message at 5 PM on the same day.
 * @param {number} messageId The ID of the message to unpin.
 */
function createUnpinTrigger(messageId) {
  // Store the message ID so the unpin function knows which message to target
  PropertiesService.getScriptProperties().setProperty('JUMAAT_MESSAGE_ID', messageId.toString());

  const unpinTime = new Date();
  unpinTime.setHours(FRIDAY_CONFIG.unpinMessageHour, 0, 0, 0); // Set time to 17:00:00

  ScriptApp.newTrigger('unpinMessageAndDeleteTrigger')
    .timeBased()
    .at(unpinTime)
    .create();
  
  Logger.log(`📅 One-time unpin trigger created for message ID ${messageId} at ${unpinTime.toLocaleString()}`);
}

/**
 * Unpins the message and deletes the trigger that called it.
 * This function is executed by the one-time trigger.
 * @param {object} e The event object passed by the trigger.
 */
function unpinMessageAndDeleteTrigger(e) {
  Logger.log("Starting 'unpinMessageAndDeleteTrigger' function.");
  const messageId = PropertiesService.getScriptProperties().getProperty('JUMAAT_MESSAGE_ID');

  if (messageId) {
    callTelegramApi('unpinChatMessage', {
      chat_id: FRIDAY_CONFIG.chatId,
      message_id: messageId
    });
    // Clean up the stored property
    PropertiesService.getScriptProperties().deleteProperty('JUMAAT_MESSAGE_ID');
  } else {
    Logger.log("Could not find a message ID to unpin.");
  }

  // Delete the one-time trigger that just ran
  const allTriggers = ScriptApp.getProjectTriggers();
  for (const trigger of allTriggers) {
    if (trigger.getUniqueId() === e.triggerUid) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log(`🗑️ Deleted one-time trigger with ID: ${e.triggerUid}`);
      break;
    }
  }
}


/**
 * SETUP FUNCTION: Run this function ONCE manually to create the weekly trigger.
 */
function setupJumaatTrigger() {
  // First, delete any existing triggers for this function to avoid duplicates
  const allTriggers = ScriptApp.getProjectTriggers();
  for (const trigger of allTriggers) {
    if (trigger.getHandlerFunction() === 'sendAndPinJumaatMessage') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log(`🗑️ Deleted existing trigger for 'sendAndPinJumaatMessage'.`);
    }
  }

  // Create a new weekly trigger
  ScriptApp.newTrigger('sendAndPinJumaatMessage')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.FRIDAY)
    .atHour(FRIDAY_CONFIG.sendMessageHour)
    .inTimezone(FRIDAY_CONFIG.timeZone)
    .create();
  
  Logger.log("✅ Successfully created weekly trigger to send the Jumaat message with an image every Friday at 12:00 PM.");
}