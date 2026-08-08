package com.wssfk.englishpracticemachine;

import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader;
import com.tom_roush.pdfbox.pdmodel.PDDocument;
import com.tom_roush.pdfbox.text.PDFTextStripper;

import org.apache.poi.hwpf.HWPFDocument;
import org.apache.poi.hwpf.usermodel.CharacterRun;
import org.apache.poi.hwpf.usermodel.Paragraph;
import org.apache.poi.hwpf.usermodel.Range;
import org.apache.poi.xwpf.usermodel.XWPFDocument;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFRun;
import org.apache.poi.xwpf.usermodel.XWPFTable;
import org.apache.poi.xwpf.usermodel.XWPFTableCell;
import org.apache.poi.xwpf.usermodel.XWPFTableRow;

import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@CapacitorPlugin(name = "DocumentExtractor")
public class DocumentExtractorPlugin extends Plugin {
    @PluginMethod
    public void extract(PluginCall call) {
        String encoded = call.getString("data", "");
        String fileName = call.getString("fileName", "");
        if (encoded.isEmpty() || fileName.isEmpty()) {
            call.reject("缺少文档内容或文件名");
            return;
        }
        try {
            byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
            if (bytes.length > 50 * 1024 * 1024) {
                call.reject("文档不能超过 50 MiB");
                return;
            }
            String lower = fileName.toLowerCase(Locale.ROOT);
            Extracted extracted;
            if (lower.endsWith(".docx") || lower.endsWith(".doc")) {
                if (isZipContainer(bytes)) extracted = extractDocx(bytes);
                else if (isOleContainer(bytes)) extracted = extractDoc(bytes);
                else {
                    call.reject("Word 文件内容与 DOC/DOCX 格式不符");
                    return;
                }
            }
            else if (lower.endsWith(".pdf")) extracted = extractPdf(bytes);
            else {
                call.reject("只支持 DOC、DOCX 或 PDF 文件");
                return;
            }
            JSObject result = new JSObject();
            result.put("format", extracted.format);
            result.put("blocks", new JSArray(extracted.blocks));
            result.put("text", String.join("\n", extracted.blocks));
            result.put("hasTextLayer", extracted.hasTextLayer);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("文档文字提取失败：" + safeMessage(error), error);
        }
    }

    private Extracted extractDoc(byte[] bytes) throws Exception {
        List<String> blocks = new ArrayList<>();
        try (HWPFDocument document = new HWPFDocument(new ByteArrayInputStream(bytes))) {
            Range range = document.getRange();
            for (int index = 0; index < range.numParagraphs(); index++) {
                Paragraph paragraph = range.getParagraph(index);
                StringBuilder text = new StringBuilder();
                for (int runIndex = 0; runIndex < paragraph.numCharacterRuns(); runIndex++) {
                    CharacterRun run = paragraph.getCharacterRun(runIndex);
                    appendRun(text, run.text(), run.getUnderlineCode() != 0);
                }
                addBlock(blocks, text.toString());
            }
        }
        return new Extracted("legacy_doc", blocks, !blocks.isEmpty());
    }

    private boolean isZipContainer(byte[] bytes) {
        return bytes.length >= 4
            && bytes[0] == 0x50
            && bytes[1] == 0x4B
            && (bytes[2] == 0x03 || bytes[2] == 0x05 || bytes[2] == 0x07)
            && (bytes[3] == 0x04 || bytes[3] == 0x06 || bytes[3] == 0x08);
    }

    private boolean isOleContainer(byte[] bytes) {
        int[] signature = { 0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1 };
        if (bytes.length < signature.length) return false;
        for (int index = 0; index < signature.length; index++) {
            if ((bytes[index] & 0xFF) != signature[index]) return false;
        }
        return true;
    }

    private Extracted extractDocx(byte[] bytes) throws Exception {
        List<String> blocks = new ArrayList<>();
        try (XWPFDocument document = new XWPFDocument(new ByteArrayInputStream(bytes))) {
            for (org.apache.poi.xwpf.usermodel.IBodyElement element : document.getBodyElements()) {
                if (element instanceof XWPFParagraph) {
                    StringBuilder text = new StringBuilder();
                    for (XWPFRun run : ((XWPFParagraph) element).getRuns()) {
                        appendRun(text, run.text(), run.getUnderline() != null
                            && run.getUnderline() != org.apache.poi.xwpf.usermodel.UnderlinePatterns.NONE);
                    }
                    addBlock(blocks, text.toString());
                } else if (element instanceof XWPFTable) {
                    for (XWPFTableRow row : ((XWPFTable) element).getRows()) {
                        StringBuilder text = new StringBuilder();
                        for (XWPFTableCell cell : row.getTableCells()) {
                            if (text.length() > 0) text.append(' ');
                            text.append(cell.getText());
                        }
                        addBlock(blocks, text.toString());
                    }
                }
            }
        }
        return new Extracted("docx", blocks, !blocks.isEmpty());
    }

    private Extracted extractPdf(byte[] bytes) throws Exception {
        PDFBoxResourceLoader.init(getContext());
        List<String> blocks = new ArrayList<>();
        try (PDDocument document = PDDocument.load(bytes)) {
            String text = new PDFTextStripper().getText(document);
            for (String line : text.split("\\R")) addBlock(blocks, line);
        }
        int visibleCharacters = String.join("", blocks).replaceAll("\\s+", "").length();
        return new Extracted("pdf", blocks, visibleCharacters >= 20);
    }

    private void appendRun(StringBuilder target, String raw, boolean underlined) {
        if (raw == null || raw.isEmpty()) return;
        String cleaned = clean(raw);
        if (underlined && cleaned.matches("(?:[1-9]|[1-4]\\d)")) {
            target.append(' ').append(cleaned).append(" ______ ");
        } else target.append(raw);
    }

    private void addBlock(List<String> blocks, String raw) {
        String cleaned = clean(raw);
        if (!cleaned.isEmpty()) blocks.add(cleaned);
    }

    private String clean(String value) {
        return value.replace('\r', ' ').replace('\u0007', ' ')
            .replace('\u00a0', ' ').replace('\u3000', ' ')
            .replaceAll("[\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u206F\\uFEFF]", "")
            .replaceAll("[ \\t]+", " ").trim();
    }

    private String safeMessage(Exception error) {
        String message = error.getMessage();
        return message == null || message.trim().isEmpty()
            ? error.getClass().getSimpleName() : message.substring(0, Math.min(300, message.length()));
    }

    private static class Extracted {
        final String format;
        final List<String> blocks;
        final boolean hasTextLayer;

        Extracted(String format, List<String> blocks, boolean hasTextLayer) {
            this.format = format;
            this.blocks = blocks;
            this.hasTextLayer = hasTextLayer;
        }
    }
}
