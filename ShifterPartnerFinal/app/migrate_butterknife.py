import os
import re
import sys

def migrate_activity(file_path):
    """Migrate Activity from ButterKnife to ViewBinding"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Skip if already migrated
    if 'ViewBinding' in content or 'binding.' in content:
        return False

    # Extract class name
    class_match = re.search(r'class\s+(\w+)\s+extends\s+AppCompatActivity', content)
    if not class_match:
        return False

    class_name = class_match.group(1)

    # Generate binding class name (e.g., MainActivity -> ActivityMainBinding)
    if class_name.endswith('Activity'):
        layout_name = 'Activity' + class_name.replace('Activity', '')
    else:
        layout_name = class_name

    binding_class = to_binding_name(layout_name)

    # Remove ButterKnife imports
    content = re.sub(r'import butterknife\..*?;?\n', '', content)

    # Add ViewBinding import
    if 'import android.os.Bundle;' in content:
        content = content.replace(
            'import android.os.Bundle;',
            f'import android.os.Bundle;\nimport com.shifter.driver.databinding.{binding_class};'
        )

    # Add binding field
    content = re.sub(
        r'(public class ' + class_name + r'.*?\{)',
        r'\1\n\n    private ' + binding_class + ' binding;',
        content
    )

    # Replace setContentView + ButterKnife.bind
    old_setup = r'setContentView\(R\.layout\.(\w+)\);\s*ButterKnife\.bind\(this\);'
    new_setup = r'binding = ' + binding_class + r'.inflate(getLayoutInflater());\n        setContentView(binding.getRoot());'
    content = re.sub(old_setup, new_setup, content)

    # Replace @BindView with binding.viewName
    # Example: @BindView(R.id.textView) TextView textView; → removed, use binding.textView
    content = re.sub(r'@BindView\(R\.id\.(\w+)\)\s+\w+\s+(\w+);', '', content)

    # Replace @OnClick
    content = re.sub(
        r'@OnClick\(R\.id\.(\w+)\)\s+void\s+(\w+)\(\)\s*\{',
        lambda m: f'// TODO: Replace with binding.{m.group(1)}.setOnClickListener',
        content
    )

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    return True

def migrate_fragment(file_path):
    """Migrate Fragment from ButterKnife to ViewBinding"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'ViewBinding' in content or 'binding.' in content:
        return False

    class_match = re.search(r'class\s+(\w+)\s+extends\s+Fragment', content)
    if not class_match:
        return False

    class_name = class_match.group(1)
    binding_class = to_binding_name(class_name.replace('Fragment', ''))

    # Remove ButterKnife imports
    content = re.sub(r'import butterknife\..*?;?\n', '', content)

    # Add ViewBinding import
    if 'import android.os.Bundle;' in content:
        content = content.replace(
            'import android.os.Bundle;',
            f'import android.os.Bundle;\nimport com.shifter.driver.databinding.{binding_class};'
        )

    # Add binding field
    content = re.sub(
        r'(public class ' + class_name + r'.*?\{)',
        r'\1\n\n    private ' + binding_class + ' binding;',
        content
    )

    # Replace onCreateView
    old_inflate = r'View view = inflater\.inflate\(R\.layout\.(\w+), container, false\);\s*ButterKnife\.bind\(this, view\);\s*return view;'
    new_inflate = f'binding = {binding_class}.inflate(inflater, container, false);\n        return binding.getRoot();'
    content = re.sub(old_inflate, new_inflate, content)

    # Add onDestroyView
    if 'onDestroyView' not in content:
        content = re.sub(
            r'(\}\s*$)',
            '\n    @Override\n    public void onDestroyView() {\n        super.onDestroyView();\n        binding = null;\n    }\n}',
            content
        )

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    return True

def to_binding_name(name):
    """Convert layout/class name to binding name"""
    # activity_main -> ActivityMainBinding
    # fragment_home -> FragmentHomeBinding
    parts = name.split('_')
    return ''.join(word.capitalize() for word in parts) + 'Binding'

def find_java_files(directory):
    """Find all Java files"""
    java_files = []
    for root, dirs, files in os.walk(directory):
        for file in files:
            if file.endswith('.java'):
                java_files.append(os.path.join(root, file))
    return java_files

def main():
    src_dir = 'app/src/main/java'

    if not os.path.exists(src_dir):
        print("Error: app/src/main/java not found!")
        return

    java_files = find_java_files(src_dir)
    print(f"Found {len(java_files)} Java files")

    migrated_count = 0

    for file_path in java_files:
        print(f"Processing: {file_path}")

        if 'Activity' in file_path:
            if migrate_activity(file_path):
                migrated_count += 1
                print(f"  ✓ Migrated Activity")
        elif 'Fragment' in file_path:
            if migrate_fragment(file_path):
                migrated_count += 1
                print(f"  ✓ Migrated Fragment")

    print(f"\n✅ Migration complete! Migrated {migrated_count} files")
    print("⚠️  Manual steps needed:")
    print("1. Replace all @BindView fields with binding.viewId")
    print("2. Replace all @OnClick with binding.viewId.setOnClickListener")
    print("3. Search for 'ButterKnife' and remove remaining references")

if __name__ == '__main__':
    main()