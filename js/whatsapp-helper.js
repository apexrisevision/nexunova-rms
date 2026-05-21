// ══ WHATSAPP HELPER ════════════════════════════════════════════════
// URL builder + message templates for client-side use

function openWhatsApp(phone, message) {
  const cleanPhone = _plCleanPhone(phone);
  const url = 'https://wa.me/' + cleanPhone + '?text=' + encodeURIComponent(message);
  window.open(url, '_blank');
}

function _plCleanPhone(phone) {
  let n = (phone || '').replace(/[^\d]/g, '');
  if (n.startsWith('0'))    return '92' + n.substring(1);
  if (n.startsWith('0092')) return '92' + n.substring(4);
  if (!n.startsWith('92'))  return '92' + n;
  return n;
}

function _plBuildWaUrl(phone) {
  return 'https://wa.me/' + _plCleanPhone(phone);
}

function _plFmtAmount(n) {
  return 'PKR ' + Number(n).toLocaleString('en-PK');
}

// Build initial payment request message (mirrors DB build_whatsapp_message)
function _plBuildInitialMsg(data) {
  const {
    clientName, unitNumber, projectName, amount, dueDate,
    refCode, methods, companyName
  } = data;

  let methodsBlock = '';
  (methods || []).forEach(m => {
    switch (m.method_type) {
      case 'jazzcash':
        methodsBlock += `💚 JazzCash\n   Account Title: ${m.account_title}\n   Number: ${m.account_number}\n\n`;
        break;
      case 'easypaisa':
        methodsBlock += `💜 EasyPaisa\n   Account Title: ${m.account_title}\n   Number: ${m.account_number}\n\n`;
        break;
      case 'bank':
        methodsBlock += `🏦 Bank Transfer\n   Bank: ${m.bank_name||''}\n   Title: ${m.account_title}\n   Account: ${m.account_number}${m.iban ? '\n   IBAN: '+m.iban : ''}\n\n`;
        break;
      case 'raast':
        methodsBlock += `⚡ Raast\n   Raast ID: ${m.account_number}\n   Title: ${m.account_title}\n\n`;
        break;
      case 'sadapay':
        methodsBlock += `🟣 SadaPay\n   Number: ${m.account_number}\n   Title: ${m.account_title}\n\n`;
        break;
      case 'nayapay':
        methodsBlock += `🔵 NayaPay\n   Number: ${m.account_number}\n   Title: ${m.account_title}\n\n`;
        break;
      default:
        methodsBlock += `💳 ${(m.method_type||'').toUpperCase()}\n   Title: ${m.account_title}\n   Account: ${m.account_number}\n\n`;
    }
  });

  return `Assalam o Alaikum ${clientName},\n\nAap ki installment due hai:\n\n` +
    `🏢 Property: ${unitNumber} - ${projectName}\n` +
    `💰 Amount: ${_plFmtAmount(amount)}\n` +
    (dueDate ? `📅 Due Date: ${dueDate}\n` : '') +
    `🔖 Reference: ${refCode}\n\n` +
    `Payment ke liye yeh options istemal karein:\n\n` +
    methodsBlock.trim() + '\n\n' +
    `Payment karne ke baad screenshot bhejein.\n\nShukriya,\n${companyName||''}`;
}

function _plBuildReminderMsg(data) {
  const { clientName, amount, refCode, daysAgo, companyName } = data;
  return `Assalam o Alaikum ${clientName},\n\n` +
    `Reminder: Aap ko ${daysAgo||'?'} din pehle payment link bheja gaya tha:\n\n` +
    `💰 Amount: ${_plFmtAmount(amount)}\n` +
    `🔖 Reference: ${refCode}\n\n` +
    `Abhi tak payment receive nahi hui. Bara meherbani ho gi agar aaj process kar dein.\n\n` +
    `Shukriya,\n${companyName||''}`;
}

function _plBuildConfirmMsg(data) {
  const { clientName, prvNumber, amount, paymentDate, unitNumber, projectName, refCode, companyName } = data;
  return `Assalam o Alaikum ${clientName},\n\n` +
    `Aap ki payment confirm ho gayi hai. JazakAllah! ✅\n\n` +
    `✅ Receipt#: ${prvNumber||''}\n` +
    `💰 Amount: ${_plFmtAmount(amount)}\n` +
    (paymentDate ? `📅 Date: ${paymentDate}\n` : '') +
    `🏢 Property: ${unitNumber} - ${projectName}\n` +
    `🔖 Reference: ${refCode}\n\n` +
    `Shukriya,\n${companyName||''}`;
}
