package com.wssfk.englishpracticemachine;

import java.math.BigInteger;
import java.util.HashMap;
import java.util.Map;
import org.apache.poi.xwpf.usermodel.XWPFParagraph;
import org.apache.poi.xwpf.usermodel.XWPFNumbering;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTLvl;
import org.openxmlformats.schemas.wordprocessingml.x2006.main.CTNumLvl;

/** Resolve visible automatic labels; never infer labels from sentence letters. */
final class DocumentNumbering {
    private final Map<String, Integer> counts = new HashMap<>();

    String prefix(XWPFParagraph paragraph) {
        BigInteger id = paragraph.getNumID();
        if (id == null) return "";
        XWPFNumbering numbering = paragraph.getDocument().getNumbering();
        if (numbering == null || numbering.getNum(id) == null) return "";
        BigInteger level = paragraph.getNumIlvl();
        int index = level == null ? 0 : level.intValue();
        var num = numbering.getNum(id).getCTNum();
        var abstractNum = numbering.getAbstractNum(num.getAbstractNumId().getVal());
        if (abstractNum == null) return "";
        CTLvl definition = null;
        for (CTLvl candidate : abstractNum.getCTAbstractNum().getLvlList()) {
            if (candidate.getIlvl().intValue() == index) definition = candidate;
        }
        CTNumLvl override = null;
        for (CTNumLvl candidate : num.getLvlOverrideList()) {
            if (candidate.getIlvl().intValue() == index) override = candidate;
        }
        if (override != null && override.isSetLvl()) definition = override.getLvl();
        if (definition == null) return "";
        int first = definition.getStart() == null ? 1 : definition.getStart().getVal().intValue();
        if (override != null && override.isSetStartOverride()) first = override.getStartOverride().getVal().intValue();
        String key = id + ":" + index;
        int value = counts.getOrDefault(key, first - 1) + 1;
        counts.put(key, value);
        for (CTLvl child : abstractNum.getCTAbstractNum().getLvlList()) {
            if (child.getIlvl().intValue() > index
                && (child.getLvlRestart() == null || child.getLvlRestart().getVal().intValue() != 0)) {
                counts.remove(id + ":" + child.getIlvl().intValue());
            }
        }
        if (definition.getNumFmt() == null || definition.getLvlText() == null) return "";
        String kind = definition.getNumFmt().getVal().toString();
        String template = definition.getLvlText().getVal();
        String marker = "%" + (index + 1);
        if (!template.contains(marker) || template.indexOf('%') != template.lastIndexOf('%')) return "";
        String label;
        if (kind.equals("decimal")) label = Integer.toString(value);
        else if ((kind.equals("upperLetter") || kind.equals("lowerLetter")) && value >= 1 && value <= 26) {
            label = Character.toString((char)((kind.equals("upperLetter") ? 'A' : 'a') + value - 1));
        } else return "";
        String visible = template.replace(marker, label);
        if (paragraph.getText().trim().matches("^" + java.util.regex.Pattern.quote(visible) + "(?:\\s.*|$)")) return "";
        return (kind.endsWith("Letter") ? "[" + label + "]" : label + ".") + " ";
    }
}
