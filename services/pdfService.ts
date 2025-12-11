

import { jsPDF } from 'jspdf';
import { ReceiptData } from '../types';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

// Colors Palette
const COLORS = {
  brandBlue: '#1e40af',
  textDark: '#1f2937', // gray-900
  textGray: '#6b7280', // gray-50
  borderGray: '#d1d5db', // gray-300
  bgLight: '#f9fafb', // gray-50
  white: '#ffffff',
  red: '#ef4444',
  blue: '#3b82f6', // blue-500
  
  // Observation Box
  obsBg: '#fefce8', // yellow-50
  obsBorder: '#fef9c3', // yellow-100
  obsTitle: '#a16207', // yellow-700
  obsText: '#374151', // gray-700

  // Stamp
  stampBlue: '#1e3a8a', // Dark Blue for stamp
};

export const createPDFDoc = async (data: ReceiptData): Promise<jsPDF> => {
  const doc = new jsPDF();
  
  // Settings
  const margin = 10; // 10mm margin
  const pageWidth = 210;
  const contentWidth = pageWidth - (margin * 2);
  const pageHeight = 297;
  
  let y = 10; // Cursor

  // Helper to check for page break
  const checkPageBreak = (heightNeeded: number) => {
    if (y + heightNeeded > pageHeight - margin) {
      doc.addPage();
      y = margin + 10; // Reset to top with a little padding
      return true;
    }
    return false;
  };

  // --- 1. HEADER SECTION ---
  const headerHeight = 40;
  doc.setFillColor(COLORS.brandBlue);
  doc.rect(0, 0, pageWidth, headerHeight, 'F');

  doc.setTextColor(COLORS.white);
  doc.setFont("times", "bold");
  doc.setFontSize(26);
  doc.text("BelConfort", margin, 20);
  
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("CAMAS E MÓVEIS", margin, 26, { charSpace: 1.5 });

  const qrSize = 25;
  const qrX = pageWidth - margin - qrSize;
  const infoX = qrX - 5; 

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("CNPJ 60.190.028/0001-60", infoX, 15, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.text("RUA B, 103C, CASTANHEIRA - BELEM/PA", infoX, 20, { align: "right" });
  
  doc.text("belconfortcamasemoveis@gmail.com", infoX, 25, { align: "right" });
  doc.text("(91) 99381-2592", infoX, 30, { align: "right" });

  try {
    const qrDataUrl = await QRCode.toDataURL('https://www.instagram.com/belconfortcamasemoveis/', {
        margin: 0,
        color: { dark: '#ffffff', light: '#1e40af' }
    });
    doc.addImage(qrDataUrl, 'PNG', qrX, 7, qrSize, qrSize);
  } catch (err) { /* ignore */ }

  y = 48; // Adjusted start position to match Preview spacing

  // --- 2. TITLE ---
  doc.setTextColor(COLORS.textDark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("COMPROVANTE DE COMPRA", pageWidth / 2, y, { align: "center" });
  
  y += 5;
  doc.setFontSize(8);
  doc.setTextColor(COLORS.textGray);
  doc.setFont("helvetica", "normal");
  const dateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  doc.text(`Emissão: ${dateStr} às ${timeStr}`, pageWidth / 2, y, { align: "center" });

  y += 6; // Reduced spacing

  // --- 3. CLIENT DATA GRID ---
  const rowHeight = 10; // Fixed reduced height
  
  // Helper to draw cell with SAFE resizing
  const drawCell = (label: string, value: string, x: number, w: number) => {
    // Draw Background/Border
    doc.setDrawColor(COLORS.borderGray);
    doc.setLineWidth(0.1);
    doc.rect(x, y, w, rowHeight);
    
    // Label
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6);
    doc.setTextColor(COLORS.textGray);
    doc.text(label.toUpperCase(), x + 2, y + 3.5);
    
    // Value processing
    doc.setFont("helvetica", "normal");
    doc.setTextColor(COLORS.textDark);
    
    let displayValue = value || '-';
    displayValue = displayValue.replace(/(\r\n|\n|\r)/gm, " "); // flatten

    const padding = 4;
    const maxWidth = w - padding; 
    let fontSize = 9;
    
    // 1. Measure at default size
    doc.setFontSize(fontSize);
    let textWidth = doc.getTextWidth(displayValue);
    
    // 2. Scale down if too big
    if (textWidth > maxWidth) {
      fontSize = (maxWidth / textWidth) * fontSize;
      if (fontSize < 5) fontSize = 5; // Hard floor for readability
    }
    doc.setFontSize(fontSize);
    
    // 3. STRICT TRUNCATION (Safety Net)
    // If text is still too wide even at min font size, cut it off
    textWidth = doc.getTextWidth(displayValue);
    if (textWidth > maxWidth) {
       // Loop to remove chars until it fits
       while (doc.getTextWidth(displayValue + "...") > maxWidth && displayValue.length > 0) {
          displayValue = displayValue.slice(0, -1);
       }
       displayValue += "...";
    }
    
    doc.text(displayValue, x + 2, y + 7.5);
  };

  // Generic Function to Distribute Row Widths
  const drawDynamicRow = (fields: {label: string, text: string, min: number}[]) => {
     checkPageBreak(rowHeight);

     doc.setFontSize(9);
     doc.setFont("helvetica", "normal");
     
     // Calculate how "wide" each content wants to be
     const neededWidths = fields.map(f => {
         // Measure Text
         const textW = doc.getTextWidth(f.text || "-");
         
         // Measure Label (Label must fit too!)
         doc.setFontSize(6);
         doc.setFont("helvetica", "bold");
         const labelW = doc.getTextWidth(f.label.toUpperCase());
         
         // Reset font for next iter
         doc.setFontSize(9);
         doc.setFont("helvetica", "normal");
         
         // We need max of text or label + padding
         const contentW = Math.max(textW, labelW) + 6; 
         
         // Return max of calculated need vs hard minimum
         return Math.max(contentW, f.min);
     });

     const totalNeeded = neededWidths.reduce((a, b) => a + b, 0);
     
     let finalWidths = [];
     if (totalNeeded === 0) {
        // Fallback: equal distribution
        finalWidths = fields.map(() => contentWidth / fields.length);
     } else {
        // Proportional Distribution
        finalWidths = neededWidths.map(nw => (nw / totalNeeded) * contentWidth);
     }
     
     // Rounding fixes to ensure exact margin alignment
     let currentX = margin;
     fields.forEach((f, i) => {
         // Last element takes remaining space to fix rounding errors
         const w = (i === fields.length - 1) 
            ? (margin + contentWidth) - currentX 
            : finalWidths[i];
         
         drawCell(f.label, f.text, currentX, w);
         currentX += w;
     });
     
     y += rowHeight;
  };

  // --- ROW 1: Date, Client, CPF ---
  const dateVal = data.date ? new Date(data.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : dateStr;
  
  drawDynamicRow([
      { label: "DATA DO PEDIDO", text: dateVal, min: 30 },
      { label: "CLIENTE", text: data.name, min: 60 },
      { label: "CPF/CNPJ", text: data.cpf || '', min: 35 }
  ]);

  // --- ROW 2: Address ---
  drawDynamicRow([
      { label: "RUA", text: data.street || "", min: 40 },
      { label: "Nº", text: data.number || "", min: 12 },
      { label: "COMPLEMENTO", text: data.complement || "", min: 10 }, 
      { label: "BAIRRO", text: data.neighborhood || "", min: 25 },
      { label: "CIDADE", text: data.city || "", min: 25 }
  ]);

  // --- ROW 3: Contacts ---
  const contactsText = [data.contact1, data.contact2].filter(Boolean).join(' / ');
  drawDynamicRow([
      { label: "E-MAIL", text: data.email || "", min: 60 },
      { label: "CONTATOS", text: contactsText, min: 60 }
  ]);

  y += 6; // Compact spacing before products

  // --- 4. PRODUCTS TABLE ---
  const cols = [
    { name: "CÓD", w: 18, align: "left" },
    { name: "DESCRIÇÃO DO PRODUTO", w: 100, align: "left" }, 
    { name: "QTD", w: 12, align: "center" },
    { name: "UNITÁRIO", w: 30, align: "right" },
    { name: "TOTAL", w: 30, align: "right" }
  ];

  checkPageBreak(20); // Check space for header

  doc.setFillColor(COLORS.bgLight);
  doc.setDrawColor(COLORS.borderGray);
  doc.rect(margin, y, contentWidth, 6, 'F'); 
  doc.line(margin, y, margin + contentWidth, y);
  doc.line(margin, y + 6, margin + contentWidth, y + 6);

  let colX = margin;
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(COLORS.brandBlue);
  
  cols.forEach(col => {
    let textX = colX + (col.align === "left" ? 2 : (col.align === "right" ? col.w - 2 : col.w / 2));
    doc.text(col.name, textX, y + 4, { align: col.align as any });
    colX += col.w;
  });

  y += 6;

  let subtotal = 0;
  
  if (data.products.length > 0) {
    data.products.forEach((p, i) => {
        const lineTotal = p.price * p.quantity;
        subtotal += lineTotal;

        doc.setFontSize(8); 
        doc.setFont("helvetica", "normal");
        const splitDesc = doc.splitTextToSize(p.name, cols[1].w - 4);
        
        let rowH = 6 + (splitDesc.length * 3.5); 
        if (p.warrantyTime) rowH += 3.5; 
        if (rowH < 8) rowH = 8; 

        // Check if this row fits, if not, new page
        if (checkPageBreak(rowH)) {
             // Redraw header on new page
             doc.setFillColor(COLORS.bgLight);
             doc.setDrawColor(COLORS.borderGray);
             doc.rect(margin, y, contentWidth, 6, 'F');
             doc.line(margin, y, margin + contentWidth, y);
             doc.line(margin, y + 6, margin + contentWidth, y + 6);
             let colX = margin;
             doc.setFontSize(7);
             doc.setFont("helvetica", "bold");
             doc.setTextColor(COLORS.brandBlue);
             cols.forEach(col => {
                let textX = colX + (col.align === "left" ? 2 : (col.align === "right" ? col.w - 2 : col.w / 2));
                doc.text(col.name, textX, y + 4, { align: col.align as any });
                colX += col.w;
             });
             y += 6;
        }

        doc.setDrawColor(COLORS.borderGray);
        doc.setLineWidth(0.1);
        doc.line(margin, y + rowH, margin + contentWidth, y + rowH);

        let currX = margin;
        doc.setTextColor(COLORS.textDark);
        doc.setFontSize(8);
        const codeText = p.code || '-';
        doc.text(codeText, currX + 2, y + 4);
        
        if (p.code) {
          try {
            const textWidth = doc.getTextWidth(codeText);
            const canvas = document.createElement('canvas');
            JsBarcode(canvas, p.code, {
              format: "CODE128", width: 1, height: 30, displayValue: false, margin: 0
            });
            const barcodeDataUrl = canvas.toDataURL('image/png');
            const finalWidth = Math.max(textWidth, 8); 
            doc.addImage(barcodeDataUrl, 'PNG', currX + 2, y + 5, finalWidth, 3.5);
          } catch(e) { /* ignore */ }
        }

        currX += cols[0].w;
        doc.setFontSize(8);
        doc.text(splitDesc, currX + 2, y + 4);
        
        if (p.warrantyTime) {
            doc.setFontSize(6);
            doc.setTextColor(COLORS.textGray);
            const warrantyTxt = `GARANTIA DE FÁBRICA: ${p.warrantyTime} ${p.warrantyUnit} | 90 DIAS LOJA`;
            doc.text(warrantyTxt, currX + 2, y + 4 + (splitDesc.length * 3.5) + 2);
        }

        currX += cols[1].w;
        doc.setFontSize(8);
        doc.setTextColor(COLORS.textDark);
        doc.text(p.quantity.toString(), currX + cols[2].w / 2, y + 4, { align: "center" });

        currX += cols[2].w;
        doc.text(p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), currX + cols[3].w - 2, y + 4, { align: "right" });

        currX += cols[3].w;
        doc.setFont("helvetica", "bold");
        doc.text(lineTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), currX + cols[4].w - 2, y + 4, { align: "right" });

        y += rowH;
    });
  } else {
    doc.setFontSize(9);
    doc.setTextColor(COLORS.textGray);
    doc.text("- Nenhum item adicionado -", pageWidth / 2, y + 10, { align: "center" });
    y += 20;
  }

  y += 4; 

  // --- 5. SUMMARY SECTION ---
  checkPageBreak(25); // Check space for summary

  const summaryStartY = y;
  const totalsWidth = 90;
  const totalsX = pageWidth - margin - totalsWidth;
  const leftBoxW = 85; 
  const leftBoxH = 21; 
  
  doc.setDrawColor(COLORS.borderGray);
  doc.setLineWidth(0.1);
  doc.rect(margin, summaryStartY, leftBoxW, leftBoxH);
  doc.line(margin, summaryStartY + 7, margin + leftBoxW, summaryStartY + 7);
  doc.line(margin, summaryStartY + 14, margin + leftBoxW, summaryStartY + 14);

  const row1Y = summaryStartY;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textGray);
  doc.text("CÓDIGO DA VENDA", margin + 2, row1Y + 4.5);
  doc.setFontSize(9);
  doc.setTextColor(COLORS.brandBlue);
  doc.text(data.saleCode.toUpperCase() || '-', margin + leftBoxW - 2, row1Y + 5, { align: "right" });

  const row2Y = summaryStartY + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textGray);
  doc.text("VENDEDOR", margin + 2, row2Y + 4.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(COLORS.textDark);
  doc.text(data.salesperson.toUpperCase() || '-', margin + leftBoxW - 2, row2Y + 5, { align: "right" });

  const row3Y = summaryStartY + 14;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(COLORS.textGray);
  doc.text("FORMA DE PAGAMENTO", margin + 2, row3Y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(COLORS.textDark);
  doc.text(data.paymentMethod.toUpperCase() || '-', margin + leftBoxW - 2, row3Y + 5, { align: "right" });

  let totalsY = summaryStartY;
  let manualDiscountAmount = 0;
  if (data.discountType === 'fixed') {
    manualDiscountAmount = data.discountValue;
  } else {
    manualDiscountAmount = subtotal * (data.discountValue / 100);
  }
  const bundleDiscountAmount = data.bundleDiscount || 0;
  const finalTotal = Math.max(0, subtotal - manualDiscountAmount - bundleDiscountAmount);

  const drawTotalLine = (label: string, value: string, color: string = COLORS.textGray, isBold: boolean = false) => {
    doc.setFont("helvetica", isBold ? "bold" : "normal");
    doc.setFontSize(isBold ? 10 : 8);
    doc.setTextColor(color);
    doc.text(label, totalsX, totalsY);
    doc.text(value, pageWidth - margin, totalsY, { align: "right" });
    totalsY += 5; 
  };

  drawTotalLine("Subtotal:", subtotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
  if (bundleDiscountAmount > 0) {
     // Use the provided bundleLabel or fallback if missing (backward compatibility)
     const bundleLabel = data.bundleLabel ? `${data.bundleLabel}:` : "Desconto Promocional:";
     drawTotalLine(bundleLabel, `- ${bundleDiscountAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, COLORS.blue);
  }
  if (manualDiscountAmount > 0) {
    drawTotalLine("Desc. Vendedor:", `- ${manualDiscountAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, COLORS.red);
  }
  totalsY += 1;
  doc.setFillColor(COLORS.bgLight);
  doc.roundedRect(totalsX - 5, totalsY - 5, totalsWidth + 5, 10, 1, 1, 'F');
  totalsY += 1.5;
  drawTotalLine("TOTAL:", finalTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), COLORS.textDark, true);

  y = Math.max(summaryStartY + leftBoxH, totalsY); 

  // --- 6. OBSERVATION ---
  y += 4;
  const obsText = "A garantia cobre exclusivamente o que está especificado na etiqueta e no certificado de cada produto.";
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  const splitObs = doc.splitTextToSize(obsText, contentWidth - 10);
  const obsBoxHeight = 10 + (splitObs.length * 3.5);

  checkPageBreak(obsBoxHeight + 5);

  doc.setDrawColor(COLORS.obsBorder);
  doc.setFillColor(COLORS.obsBg);
  doc.roundedRect(margin, y, contentWidth, obsBoxHeight, 2, 2, 'FD');
  doc.setTextColor(COLORS.obsTitle);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("OBSERVAÇÃO", pageWidth / 2, y + 5, { align: "center" });
  doc.setTextColor(COLORS.obsText);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.text(splitObs, pageWidth / 2, y + 9, { align: "center" });
  
  y += obsBoxHeight + 4; 

  // --- 7. RETURN POLICY (CDC) ---
  const policyHeight = 58; 
  
  // Important: Check if policy fits
  checkPageBreak(policyHeight + 10);

  doc.setDrawColor(COLORS.borderGray);
  doc.setFillColor('#f8fafc'); 
  doc.roundedRect(margin, y, contentWidth, policyHeight, 2, 2, 'FD');
  
  let policyY = y + 5;
  doc.setTextColor(COLORS.textDark);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("POLÍTICA DE TROCAS E DEVOLUÇÕES", pageWidth / 2, policyY, { align: "center" });
  doc.setDrawColor(COLORS.borderGray);
  doc.setLineWidth(0.1);
  doc.line(margin + 5, policyY + 2, pageWidth - margin - 5, policyY + 2);
  
  policyY += 8;
  
  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(51, 65, 85); 
  doc.text("DIREITO DE ARREPENDIMENTO", margin + 3, policyY);
  
  const widthTitle = doc.getTextWidth("DIREITO DE ARREPENDIMENTO");
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139); 
  doc.text("(Art. 49 do CDC):", margin + 3 + widthTitle + 1, policyY);

  policyY += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105); 
  const textArrep = "O cliente tem o prazo de até 7 (sete) dias corridos para desistir da compra, contados a partir do recebimento do produto, desde que esteja sem uso e com lacre intacto.";
  const splitArrep = doc.splitTextToSize(textArrep, contentWidth - 6);
  doc.text(splitArrep, margin + 3, policyY);
  policyY += (splitArrep.length * 3);

  doc.text("• Compras online: frete de devolução por conta da empresa.", margin + 5, policyY);
  policyY += 5;

  doc.setTextColor(51, 65, 85); 
  doc.setFont("helvetica", "bold");
  doc.text("COMPRAS EM LOJA FÍSICA:", margin + 3, policyY);
  
  policyY += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105); 
  const textFisica = "Compras realizadas em loja física não possuem direito de arrependimento, conforme o Código de Defesa do Consumidor, exceto em casos de defeito de fabricação.";
  const splitFisica = doc.splitTextToSize(textFisica, contentWidth - 6);
  doc.text(splitFisica, margin + 3, policyY);
  policyY += (splitFisica.length * 3) + 2;

  doc.setTextColor(51, 65, 85); 
  doc.setFont("helvetica", "bold");
  doc.text("DEFEITOS DE FABRICAÇÃO (Garantia Legal):", margin + 3, policyY);
  
  policyY += 3.5;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(71, 85, 105); 
  doc.text("• Garantia legal de 90 (noventa) dias, conforme o CDC.", margin + 5, policyY);
  policyY += 3.5;
  doc.text("• Após esse prazo, aplicar-se-á a garantia contratual do fabricante, quando houver, conforme certificado.", margin + 5, policyY);

  y += policyHeight;

  // --- 8. FOOTER LAYERS (Relative to Content) ---
  
  const footerNeededHeight = 45;
  // Check if footer fits, otherwise add page
  checkPageBreak(footerNeededHeight);

  // Position footer below current 'y'
  const footerStart = y + 10;
  const stampY = footerStart;
  const footerY = stampY + 20;

  const bracketSize = 5; 
  const sigStartX = (pageWidth / 2) - 15;
  const sigStartY = stampY + 18;

  doc.setDrawColor(COLORS.textDark);
  doc.setLineWidth(0.1);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(pageWidth / 4, footerY, (pageWidth / 4) * 3, footerY);
  
  doc.setFontSize(8);
  doc.setTextColor(COLORS.textGray);
  doc.setFont("helvetica", "normal");
  doc.text("Assinatura do Responsável", pageWidth / 2, footerY + 5, { align: "center" });

  doc.setFontSize(7);
  doc.setTextColor(200, 200, 200);
  // Bottom of page text, or below signature if multiple pages
  const bottomTextY = Math.max(footerY + 15, pageHeight - 10);
  doc.text("Documento gerado pelo Ecosistema Belconfort", pageWidth / 2, bottomTextY, { align: "center" });

  doc.setDrawColor(80, 90, 120);
  doc.setLineWidth(0.08);
  doc.setLineDashPattern([], 0);

  doc.moveTo(sigStartX, sigStartY);
  doc.curveTo(sigStartX + 2, sigStartY - 15, sigStartX + 8, sigStartY - 15, sigStartX + 8, sigStartY);
  doc.curveTo(sigStartX + 8, sigStartY - 12, sigStartX + 14, sigStartY - 12, sigStartX + 14, sigStartY);
  doc.curveTo(sigStartX + 16, sigStartY - 3, sigStartX + 18, sigStartY + 2, sigStartX + 19, sigStartY - 1);
  doc.lineTo(sigStartX + 21, sigStartY - 8);
  doc.lineTo(sigStartX + 21, sigStartY);
  doc.curveTo(sigStartX + 22, sigStartY - 10, sigStartX + 26, sigStartY - 10, sigStartX + 26, sigStartY);
  doc.curveTo(sigStartX + 26, sigStartY - 5, sigStartX + 29, sigStartY - 5, sigStartX + 29, sigStartY);
  doc.curveTo(sigStartX + 32, sigStartY - 2, sigStartX + 35, sigStartY + 2, sigStartX + 38, sigStartY - 2);
  doc.moveTo(sigStartX - 5, sigStartY + 5);
  doc.curveTo(sigStartX + 10, sigStartY + 8, sigStartX + 30, sigStartY + 3, sigStartX + 45, sigStartY + 6);
  doc.stroke();

  doc.setDrawColor(COLORS.stampBlue);
  doc.setLineWidth(0.5); 
  doc.setLineDashPattern([], 0);

  const stampW = 55; 
  const stampH = 22; 
  const stampX = (pageWidth - stampW) / 2;
  const compactBracketSize = 3;
  
  doc.line(stampX, stampY, stampX + compactBracketSize, stampY);
  doc.line(stampX, stampY, stampX, stampY + compactBracketSize);
  
  doc.line(stampX + stampW, stampY, stampX + stampW - compactBracketSize, stampY);
  doc.line(stampX + stampW, stampY, stampX + stampW, stampY + compactBracketSize);
  
  doc.line(stampX, stampY + stampH, stampX + compactBracketSize, stampY + stampH);
  doc.line(stampX, stampY + stampH, stampX, stampY + stampH - compactBracketSize);
  
  doc.line(stampX + stampW, stampY + stampH, stampX + stampW - compactBracketSize, stampY + stampH);
  doc.line(stampX + stampW, stampY + stampH, stampX + stampW, stampY + stampH - compactBracketSize);

  doc.setTextColor(COLORS.stampBlue);
  
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("60.190.028/0001-60", pageWidth / 2, stampY + 6, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text("BELCONFORT CAMAS E MÓVEIS", pageWidth / 2, stampY + 11, { align: "center" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6);
  doc.text("RUA B, 103C, CASTANHEIRA", pageWidth / 2, stampY + 16, { align: "center" });
  doc.text("BELEM - PA", pageWidth / 2, stampY + 19, { align: "center" });

  return doc;
};

export const generateReceiptPDF = async (data: ReceiptData) => {
  const doc = await createPDFDoc(data);
  const safeName = data.name ? data.name.toUpperCase() : 'CLIENTE';
  const fileName = `COMPROVANTE - ${safeName}.pdf`;
  doc.save(fileName);
};

export const getReceiptBlob = async (data: ReceiptData): Promise<Blob> => {
  const doc = await createPDFDoc(data);
  return doc.output('blob');
};