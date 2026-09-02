package com.shifter.driver.model;

import java.util.List;

public class SurveyModel {
    private List<Question> surveryList;

    public List<Question> getSurveryList() {
        return surveryList;
    }

    public void setSurveryList(List<Question> surveryList) {
        this.surveryList = surveryList;
    }

    public static class Question {
        private String questionTitle;
        private String questionType;
        private List<Option> optionData;

        public String getQuestionTitle() { return questionTitle; }
        public String getQuestionType() { return questionType; }
        public List<Option> getOptionData() { return optionData; }
    }

    public static class Option {
        private String optionTitle;

        public String getOptionTitle() { return optionTitle; }
    }
}
