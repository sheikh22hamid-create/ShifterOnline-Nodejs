package com.shifter.driver.fragment;

import static com.shifter.driver.activity.EngagementQuestionActivity.jsonArray;
import static com.shifter.driver.activity.EngagementQuestionActivity.survery;

import android.os.Bundle;

import androidx.fragment.app.Fragment;

import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.CheckBox;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;

import com.shifter.driver.R;
import com.shifter.driver.databinding.FragmentQustionBinding;

import org.json.JSONException;
import org.json.JSONObject;

public class QustionFragment extends Fragment {
    private FragmentQustionBinding binding;
    int po;


    public QustionFragment(int potion) {
        // Required empty public constructor
        po = potion;
    }


    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

    }

    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container,
                             Bundle savedInstanceState) {
        binding = FragmentQustionBinding.inflate(inflater, container, false);
        
        binding.txtQustion.setText(survery.getSurveryList().get(po).getQuestionTitle());


        try {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("question_text", survery.getSurveryList().get(po).getQuestionTitle());


            LayoutInflater layoutInflater = getLayoutInflater();

            if (survery.getSurveryList().get(po).getQuestionType().equalsIgnoreCase("Checkbox")) {

                for (int i = 0; i < survery.getSurveryList().get(po).getOptionData().size(); i++) {
                    // Add the text layout to the parent layout
                    View view1 = layoutInflater.inflate(R.layout.item_qustionlist, binding.lvlOption, false);
                    CheckBox textView = view1.findViewById(R.id.ch_option4);
                    textView.setVisibility(View.VISIBLE);
                    textView.setText(survery.getSurveryList().get(po).getOptionData().get(i).getOptionTitle());
                    int finalI = i;
                    textView.setOnClickListener(new View.OnClickListener() {
                        @Override
                        public void onClick(View view) {
                            try {
                                if (textView.isChecked()) {
                                    if (jsonObject.has("answer_text")) {
                                        jsonObject.put("answer_text", jsonObject.getString("answer_text") + "," + survery.getSurveryList().get(po).getOptionData().get(finalI).getOptionTitle());

                                    } else {
                                        jsonObject.put("answer_text", survery.getSurveryList().get(po).getOptionData().get(finalI).getOptionTitle());
                                    }
                                } else {
                                    jsonObject.put("answer_text", jsonObject.getString("answer_text").replace(survery.getSurveryList().get(po).getOptionData().get(finalI).getOptionTitle(), ""));
                                }
                                jsonArray.remove(po);
                                jsonArray.put(jsonObject);

                            } catch (JSONException e) {
                                Log.e("Error-- ", "-" + e.getMessage());
                            }
                        }
                    });

                    binding.lvlOption.addView(view1);
                }

            } else {
                View view1 = layoutInflater.inflate(R.layout.item_qustionlist, binding.lvlOption, false);
                CheckBox textView = view1.findViewById(R.id.ch_option4);
                RadioGroup radiobutton = view1.findViewById(R.id.radiobutton);
                textView.setVisibility(View.GONE);
                radiobutton.setVisibility(View.VISIBLE);
                final RadioButton[] rb = new RadioButton[survery.getSurveryList().get(po).getOptionData().size()];
                for (int i = 0; i < survery.getSurveryList().get(po).getOptionData().size(); i++) {
                    rb[i] = new RadioButton(getActivity());
                    rb[i].setId(i + 100);
                    rb[i].setText(survery.getSurveryList().get(po).getOptionData().get(i).getOptionTitle());
                    radiobutton.addView(rb[i]);
                }
                radiobutton.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
                    @Override
                    public void onCheckedChanged(RadioGroup radioGroup, int i) {

                    }
                });
                radiobutton.setOnCheckedChangeListener(new RadioGroup.OnCheckedChangeListener() {
                    public void onCheckedChanged(RadioGroup group, int checkedId) {
                        // checkedId is the RadioButton selected
                        RadioButton rb = getActivity().findViewById(checkedId);
                        try {
                            jsonObject.put("answer_text", rb.getText().toString());
                            jsonArray.remove(po);

                            jsonArray.put(jsonObject);
                        } catch (JSONException e) {
                            e.printStackTrace();
                        }

                    }
                });
                binding.lvlOption.addView(view1);
            }

        } catch (Exception e) {
            Log.e("Error", "--->" + e.getMessage());
        }

        return binding.getRoot();
    }

    @Override
    public void onDestroyView() {
        super.onDestroyView();
        binding = null;
    }
}
