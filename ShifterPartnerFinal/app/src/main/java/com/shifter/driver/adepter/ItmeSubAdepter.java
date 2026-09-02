package com.shifter.driver.adepter;

import android.content.Context;
import android.util.Log;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.LinearLayout;

import androidx.recyclerview.widget.RecyclerView;

import com.bumptech.glide.Glide;
import com.shifter.driver.R;
import com.shifter.driver.retrofit.APIClient;

import java.util.List;

public class ItmeSubAdepter extends RecyclerView.Adapter<ItmeSubAdepter.ViewHolder> {

    List<String> itmeimageList;
    Context context;
    public static class ViewHolder extends RecyclerView.ViewHolder {

        public ImageView imgA;
        public LinearLayout lvlItemclick;
        public ViewHolder(View itemView) {
            super(itemView);
        // TODO: Add findViewById for views
        // Example: textView = itemView.findViewById(R.id.text_view);
            

        }
    }

    public ItmeSubAdepter(List<String> itmeimageList, Context context) {
        this.itmeimageList = itmeimageList;
        this.context = context;
    }
    @Override
    public ItmeSubAdepter.ViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View v = LayoutInflater.from(parent.getContext()).inflate(R.layout.item_order_sub, parent, false);
        ViewHolder vh = new ViewHolder(v);
        return vh;
    }

    @Override
    public void onBindViewHolder(ItmeSubAdepter.ViewHolder holder, int position) {
        Log.e("image url","-->"+itmeimageList.toString());

        if(itmeimageList.get(position).contains("item_list") || itmeimageList.get(position).contains("images")){

            Glide.with(context).load(APIClient.baseUrl+ itmeimageList.get(position)).into(holder.imgA);

        }else {
            Glide.with(context).load(itmeimageList.get(position)).into(holder.imgA);
        }


    }

    @Override
    public int getItemCount() {
        return itmeimageList.size();
    }

}
