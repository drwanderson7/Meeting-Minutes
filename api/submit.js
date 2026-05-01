const PDFDocument = require('pdfkit');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      date, time, location, topic, facilitator, recorder,
      participants, discussedItems, actionItems, notes, recipients
    } = req.body;

    if (!topic)                        return res.status(400).json({ error: 'Meeting topic is required.' });
    if (!facilitator)                  return res.status(400).json({ error: 'Facilitator is required.' });
    if (!recipients || !recipients.length) return res.status(400).json({ error: 'At least one recipient is required.' });

    // ── FORMAT HELPERS ──────────────────────────────────────────────────────
    function formatDate(d) {
      if (!d) return '—';
      const [y, m, day] = d.split('-');
      return `${m}/${day}/${y}`;
    }
    function formatTime(t) {
      if (!t) return '—';
      const [h, m] = t.split(':');
      const hr = parseInt(h);
      return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
    }

    const fDate = formatDate(date);
    const fTime = formatTime(time);
    const safeTopic = (topic || 'Meeting').replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '_');
    const safeDate  = (date || '').replace(/-/g, '');
    const fileName  = `Minutes_${safeTopic}_${safeDate}.pdf`;

    // ── BUILD PDF ───────────────────────────────────────────────────────────
    const pdfBuffer = await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 50, bufferPages: true });
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = doc.page.width;
      const marginL = 50, marginR = 50, contentW = W - marginL - marginR;

      // ── HEADER ────────────────────────────────────────────────────────────
      doc.rect(0, 0, W, 56).fill('#1E2A3A');
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#FFFFFF')
         .text('FONTAINE HEAVY HAUL', marginL, 16);
      doc.fontSize(10).font('Helvetica').fillColor('#7FA8D4')
         .text('Meeting Minutes', marginL, 33);
      doc.fontSize(9).fillColor('#7FA8D4')
         .text(fDate, W - marginR, 30, { align: 'right', width: contentW });

      let y = 76;

      // ── TITLE ─────────────────────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#1A1A2E')
         .text(topic, marginL, y, { width: contentW });
      y = doc.y + 8;
      doc.moveTo(marginL, y).lineTo(W - marginR, y).strokeColor('#E2E4E8').lineWidth(1).stroke();
      y += 14;

      // ── META ──────────────────────────────────────────────────────────────
      function metaRow(label, value) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#6B7280')
           .text(label.toUpperCase(), marginL, y, { continued: true, width: 90 });
        doc.font('Helvetica').fillColor('#1A1A2E')
           .text(value || '—', { width: contentW - 90 });
        y = doc.y + 2;
      }
      metaRow('Date',         fDate);
      metaRow('Time',         fTime);
      metaRow('Location',     location || '—');
      metaRow('Facilitator',  facilitator);
      metaRow('Recorded By',  recorder || '—');

      y = doc.y + 8;
      doc.moveTo(marginL, y).lineTo(W - marginR, y).strokeColor('#E2E4E8').lineWidth(1).stroke();
      y += 14;

      // ── SECTION HEADING ───────────────────────────────────────────────────
      function sectionHeading(title, r, g, b) {
        if (y > doc.page.height - 80) { doc.addPage(); y = 50; }
        doc.circle(marginL + 4, y - 3, 4).fill(`rgb(${r},${g},${b})`);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#6B7280')
           .text(title.toUpperCase(), marginL + 14, y - 6, { width: contentW - 14 });
        y = doc.y + 4;
        doc.moveTo(marginL, y).lineTo(W - marginR, y).strokeColor('#E2E4E8').lineWidth(0.5).stroke();
        y += 10;
      }

      function checkPage(needed = 30) {
        if (y + needed > doc.page.height - 60) { doc.addPage(); y = 50; }
      }

      // ── PARTICIPANTS ──────────────────────────────────────────────────────
      sectionHeading('Participants', 22, 163, 74);
      const pLine = (participants && participants.length) ? participants.join(', ') : '(not specified)';
      doc.fontSize(10).font('Helvetica').fillColor('#1A1A2E')
         .text(pLine, marginL, y, { width: contentW });
      y = doc.y + 16;

      // ── ITEMS DISCUSSED ───────────────────────────────────────────────────
      sectionHeading('Items Discussed', 202, 138, 4);
      if (!discussedItems || discussedItems.length === 0) {
        doc.fontSize(10).font('Helvetica-Oblique').fillColor('#6B7280')
           .text('(none recorded)', marginL, y);
        y = doc.y + 16;
      } else {
        discussedItems.forEach((d, i) => {
          checkPage(36);
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#1A1A2E')
             .text(`${i + 1}.  ${d.topic || '(no topic)'}`, marginL, y, { width: contentW });
          y = doc.y + 2;
          if (d.notes) {
            doc.fontSize(9.5).font('Helvetica').fillColor('#4B5563')
               .text(d.notes, marginL + 14, y, { width: contentW - 14 });
            y = doc.y + 4;
          }
          y += 8;
        });
      }

      // ── ACTION ITEMS ──────────────────────────────────────────────────────
      sectionHeading('Action Items', 220, 38, 38);
      if (!actionItems || actionItems.length === 0) {
        doc.fontSize(10).font('Helvetica-Oblique').fillColor('#6B7280')
           .text('(no action items)', marginL, y);
        y = doc.y + 16;
      } else {
        actionItems.forEach((a, i) => {
          checkPage(50);
          const boxH = a.topic ? 52 : 42;
          doc.roundedRect(marginL, y - 10, contentW, boxH, 4).fill('#EFF6FF');
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#1A1A2E')
             .text(`${i + 1}.  ${a.task}`, marginL + 10, y, { width: contentW - 20 });
          y = doc.y + 4;
          doc.fontSize(9).font('Helvetica').fillColor('#6B7280')
             .text(`Assigned To: ${a.owner || '—'}`, marginL + 10, y, { continued: true, width: 180 });
          doc.text(`Due: ${a.due || '—'}`, { width: 150 });
          y = doc.y + 2;
          if (a.topic) {
            doc.fontSize(9).fillColor('#9CA3AF')
               .text(`Re: ${a.topic}`, marginL + 10, y, { width: contentW - 20 });
            y = doc.y + 2;
          }
          y += 14;
        });
      }

      // ── ADDITIONAL NOTES ──────────────────────────────────────────────────
      if (notes) {
        sectionHeading('Additional Notes', 107, 114, 128);
        doc.fontSize(10).font('Helvetica').fillColor('#1A1A2E')
           .text(notes, marginL, y, { width: contentW });
        y = doc.y + 16;
      }

      // ── FOOTER ON EVERY PAGE ──────────────────────────────────────────────
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(pages.start + i);
        const pH = doc.page.height;
        doc.rect(0, pH - 28, W, 28).fill('#1E2A3A');
        doc.fontSize(8).font('Helvetica').fillColor('#7FA8D4')
           .text('Fontaine Heavy Haul — Confidential', marginL, pH - 16, { width: contentW / 2 });
        doc.text(`Page ${i + 1} of ${pages.count}`, W - marginR - 80, pH - 16, { width: 80, align: 'right' });
      }

      doc.end();
    });

    // ── SEND EMAIL ──────────────────────────────────────────────────────────
    const emailSubject = `Meeting Minutes | ${topic} | ${fDate}`;

    await resend.emails.send({
      from: 'Meeting Minutes <minutes@fontainespecialized.com>',
      to: recipients,
      subject: emailSubject,
      html: `
        <div style="font-family:Segoe UI,sans-serif;max-width:560px;margin:0 auto;">
          <div style="background:#1E2A3A;padding:20px 28px;border-radius:8px 8px 0 0;">
            <div style="color:#fff;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;">Fontaine Heavy Haul</div>
            <div style="color:#7FA8D4;font-size:11px;margin-top:2px;">Meeting Minutes</div>
          </div>
          <div style="background:#f9fafb;border:1px solid #E2E4E8;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px;">
            <h2 style="margin:0 0 16px;font-size:18px;color:#1A1A2E;">${topic}</h2>
            <table style="width:100%;font-size:13px;color:#374151;border-collapse:collapse;">
              <tr><td style="padding:4px 0;color:#6B7280;font-weight:600;width:110px;">Date</td><td>${fDate}</td></tr>
              <tr><td style="padding:4px 0;color:#6B7280;font-weight:600;">Time</td><td>${fTime}</td></tr>
              <tr><td style="padding:4px 0;color:#6B7280;font-weight:600;">Location</td><td>${location || '—'}</td></tr>
              <tr><td style="padding:4px 0;color:#6B7280;font-weight:600;">Facilitator</td><td>${facilitator}</td></tr>
              <tr><td style="padding:4px 0;color:#6B7280;font-weight:600;">Recorded By</td><td>${recorder || '—'}</td></tr>
            </table>
            <hr style="border:none;border-top:1px solid #E2E4E8;margin:16px 0;">
            <p style="font-size:13px;color:#6B7280;margin:0;">The full meeting minutes are attached as a PDF.</p>
          </div>
        </div>
      `,
      attachments: [{
        filename: fileName,
        content: pdfBuffer.toString('base64')
      }]
    });

    return res.status(200).json({ ok: true, fileName });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
